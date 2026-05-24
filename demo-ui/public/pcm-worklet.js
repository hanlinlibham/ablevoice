// pcm-worklet.js — AudioWorkletProcessor that takes raw float32 mic
// samples, downsamples to a target sample rate (default 16kHz, what the
// ASR model wants), packs them as little-endian int16, and posts them
// back to the main thread in ~50ms chunks. The main thread is expected
// to forward each chunk over a WebSocket as a binary frame.
//
// Why we don't just set AudioContext.sampleRate = 16000:
//   - Safari and some Chrome versions silently fall back to 48kHz when
//     given an unsupported sampleRate, so we'd have no way to know
//     whether our PCM is actually 16k. Doing the resample in the
//     worklet means we control the rate that's stamped on the wire.
//
// Why naive linear resampling instead of a proper polyphase filter:
//   - For 48k → 16k speech, naive linear sounds basically identical to
//     more elaborate resamplers as far as ASR accuracy is concerned.
//     If we ever hit aliasing problems we can swap in a windowed-sinc.

const TARGET_RATE = 16000;
// 50ms at 16kHz = 800 samples. Small enough that streaming latency
// is invisible, large enough to keep WS message rate sane (~20/s).
const FRAME_SAMPLES = 800;

class PCMWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this._inRate = sampleRate; // global from AudioWorkletGlobalScope
    this._ratio = this._inRate / TARGET_RATE;
    // Holds the next "virtual" source-sample index we want to read.
    // Carrying it across `process()` calls preserves phase between
    // 128-sample quanta so we don't get a tiny click every 2.7ms.
    this._srcCursor = 0;
    // int16 PCM bytes pending flush.
    this._out = new Int16Array(FRAME_SAMPLES);
    this._outFill = 0;
    // Accumulator of source float samples; we need at least one extra
    // sample beyond _srcCursor to interpolate, so the tail of one
    // quantum often gets held over for the next.
    this._src = new Float32Array(0);
  }

  // process() is called once per render quantum (128 samples per channel).
  // `inputs[0][0]` is the float32 buffer for input 0, channel 0. We only
  // listen to channel 0 — if the user has a stereo mic, we drop the
  // right channel rather than mixing (speech is mono anyway).
  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch || ch.length === 0) return true;

    // Concatenate any held-over tail from last call with the new quantum.
    const combined = new Float32Array(this._src.length + ch.length);
    combined.set(this._src, 0);
    combined.set(ch, this._src.length);
    this._src = combined;

    // Walk forward by `_ratio` source samples per output sample, linear-
    // interpolating between neighbours, until we'd need a sample beyond
    // the current buffer.
    while (this._srcCursor + 1 < this._src.length) {
      const i0 = Math.floor(this._srcCursor);
      const frac = this._srcCursor - i0;
      const s = this._src[i0] * (1 - frac) + this._src[i0 + 1] * frac;
      // Clip and quantize to int16.
      let v = Math.max(-1, Math.min(1, s));
      this._out[this._outFill++] = v < 0 ? v * 0x8000 : v * 0x7FFF;
      this._srcCursor += this._ratio;
      if (this._outFill >= FRAME_SAMPLES) {
        // Transfer ownership of the buffer to avoid a copy.
        const buf = this._out.buffer;
        this.port.postMessage(buf, [buf]);
        this._out = new Int16Array(FRAME_SAMPLES);
        this._outFill = 0;
      }
    }

    // Hold over the unread tail of the source buffer + rebase the cursor
    // so we don't lose precision over long sessions.
    const keepFrom = Math.floor(this._srcCursor);
    this._src = this._src.slice(keepFrom);
    this._srcCursor -= keepFrom;

    return true;
  }
}

registerProcessor("pcm-worklet", PCMWorklet);
