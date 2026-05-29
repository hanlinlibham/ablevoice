"""Voice activity detection + turn endpointing — fully local, CPU-only.

Three pieces, deliberately split so the decision logic is unit-testable
without loading any model.

``SileroVad``
    Thin onnxruntime wrapper around ``silero_vad.onnx`` (v5 interface:
    ``input(1,256) + state(2,1,128) + sr`` → ``output(1,1)=prob + stateN``).
    Stateful: the model carries an LSTM hidden state across frames, so one
    instance handles ONE continuous stream and must be ``reset()`` between
    turns. Fixed 256-sample / 16ms frames at 16kHz (see VAD_FRAME_SAMPLES).
    Inference is synchronous and sub-ms on CPU, so callers run it inline on
    the event loop — NOT the MLX GPU thread. That keeps VAD off the
    serialized GPU executor (see runtime.py): a static silence frame must
    not queue behind a TTS chunk.

``FrameChunker``
    Re-blocks the browser worklet's 800-sample (50ms) int16 frames into the
    fixed 256-sample float32 frames silero requires, carrying the remainder
    across calls. Pure / no model.

``EndpointDetector``
    Pure state machine over a stream of ``(speech_prob, stable_text)``. No
    model, no wall clock — it counts ``frame_ms`` so tests drive it
    deterministically. Tier 1 = silence-timeout endpointing; tier 2 shrinks
    or extends the silence budget from the tail of the stable ASR partial
    (terminal punctuation → end sooner; trailing filler / comma → wait
    longer). Emits ``"onset"`` / ``"endpoint"`` events.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import numpy as np

DEFAULT_SAMPLE_RATE = 16000
# Frame size for the silero call. The published silero_vad.onnx weights
# (verified empirically against both the GitHub-master file and the PyPI
# wheel) respond to a 256-sample window at 16kHz — speech → ~0.99, silence
# → ~0.01 — but stay essentially flat (~0.004) for the 512-sample window
# the docs nominally describe. So we feed 256 samples (16ms) per call.
VAD_FRAME_SAMPLES = 256
VAD_FRAME_MS = 16


# --- Silero ONNX wrapper ----------------------------------------------------

class SileroVad:
    """One instance == one continuous audio stream. Call ``prob()`` with
    consecutive 512-sample frames; call ``reset()`` to clear the LSTM
    state between turns (stale state from a prior turn biases the first
    few frames of the next one)."""

    def __init__(self, model_path: str, sample_rate: int = DEFAULT_SAMPLE_RATE):
        self._model_path = str(model_path)
        self._sr = np.array(sample_rate, dtype=np.int64)
        self._session = None  # lazy — onnxruntime import is not free
        self._state = np.zeros((2, 1, 128), dtype=np.float32)

    def _ensure(self) -> None:
        if self._session is not None:
            return
        import onnxruntime as ort  # noqa: PLC0415 — keep import lazy
        opts = ort.SessionOptions()
        # Single-threaded: each call is one 512-sample frame, threading
        # overhead would dwarf the compute and we want it off the hot path.
        opts.inter_op_num_threads = 1
        opts.intra_op_num_threads = 1
        self._session = ort.InferenceSession(
            self._model_path, sess_options=opts,
            providers=["CPUExecutionProvider"],
        )

    def reset(self) -> None:
        """Clear LSTM state — call between turns."""
        self._state = np.zeros((2, 1, 128), dtype=np.float32)

    def prob(self, frame_f32: np.ndarray) -> float:
        """Speech probability in [0,1] for one 512-sample float32 frame
        (values in [-1,1]). Advances the internal LSTM state."""
        self._ensure()
        if frame_f32.shape[-1] != VAD_FRAME_SAMPLES:
            raise ValueError(
                f"silero v5 needs {VAD_FRAME_SAMPLES} samples, "
                f"got {frame_f32.shape[-1]}"
            )
        x = frame_f32.reshape(1, VAD_FRAME_SAMPLES).astype(np.float32, copy=False)
        out, self._state = self._session.run(
            ["output", "stateN"],
            {"input": x, "state": self._state, "sr": self._sr},
        )
        return float(out.reshape(-1)[0])


# --- PCM re-blocking --------------------------------------------------------

class FrameChunker:
    """Turn an arbitrary int16-LE PCM byte stream into fixed-size float32
    frames. The browser worklet ships 800-sample (50ms) frames; silero
    wants 256 (16ms). Holds the leftover tail across ``push`` calls so no
    samples are lost or duplicated."""

    def __init__(self, frame_samples: int = VAD_FRAME_SAMPLES):
        self._frame = frame_samples
        self._buf = np.zeros(0, dtype=np.float32)

    def push(self, pcm_bytes: bytes) -> list[np.ndarray]:
        """Append raw int16-LE PCM, return any complete frames it produced."""
        samples = np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float32) / 32768.0
        if self._buf.size:
            samples = np.concatenate([self._buf, samples])
        n_full = (samples.size // self._frame) * self._frame
        frames = [samples[i:i + self._frame] for i in range(0, n_full, self._frame)]
        self._buf = samples[n_full:].copy()
        return frames

    def reset(self) -> None:
        self._buf = np.zeros(0, dtype=np.float32)


# --- Endpoint decision logic (pure, model-free) -----------------------------

# A stable-partial ending in one of these signals the thought is COMPLETE —
# we can declare end-of-turn sooner.
TERMINAL_PUNCT = "。！？!?…．."
# A trailing comma/colon means the user is mid-list / mid-clause — wait longer.
TRAILING_COMMA = ("，", ",", "、", "；", ";", "：", ":")
# Trailing filler / connective words strongly imply "I'm not done talking" —
# extend the silence budget so a mid-sentence pause isn't cut off.
TRAILING_FILLERS = (
    "然后", "那个", "就是", "这个", "所以", "因为", "但是", "而且",
    "还有", "比如", "的话", "嗯", "呃", "额", "就", "让我想想", "稍等",
)


@dataclass(frozen=True)
class EndpointConfig:
    """All knobs for the endpoint state machine. ``frame_ms`` ties the
    counters to silero's 32ms cadence; tests can override it."""
    threshold: float = 0.5        # speech_prob >= this counts as speech
    frame_ms: int = VAD_FRAME_MS
    onset_ms: int = 128           # sustained speech needed to start a turn (debounce)
    silence_ms: int = 900         # default end-of-turn trailing silence
    silence_ms_short: int = 480   # tier-2: after terminal punctuation
    silence_ms_long: int = 1500   # tier-2: after a filler / trailing comma


class EndpointDetector:
    """Tracks one hands-free listening stream. Feed every frame's
    ``speech_prob`` (plus the latest stable ASR partial, for tier-2) and
    react to the returned event:

      - ``"onset"``   — sustained speech began; start capturing/feeding ASR.
      - ``"endpoint"``— trailing silence exceeded the budget; finalize the turn.
      - ``None``      — no transition this frame.

    After ``"endpoint"`` the detector auto-resets to WAITING, ready for the
    next turn. Callers ``reset()`` on stop_handsfree / barge-in."""

    WAITING = "waiting"
    SPEAKING = "speaking"

    def __init__(self, cfg: Optional[EndpointConfig] = None):
        self.cfg = cfg or EndpointConfig()
        self.reset()

    def reset(self) -> None:
        self.state = self.WAITING
        self._speech_run_ms = 0
        self._silence_run_ms = 0

    def _silence_budget(self, stable_text: str) -> int:
        """Tier-2: pick the end-of-turn silence threshold from the tail of
        the stable partial. Tier-1 behaviour falls out when stable_text is
        empty (e.g. ASR hasn't emitted yet) → the plain default."""
        t = (stable_text or "").rstrip()
        if not t:
            return self.cfg.silence_ms
        last = t[-1]
        if last in TERMINAL_PUNCT:
            return self.cfg.silence_ms_short
        if last in TRAILING_COMMA:
            return self.cfg.silence_ms_long
        for filler in TRAILING_FILLERS:
            if t.endswith(filler):
                return self.cfg.silence_ms_long
        return self.cfg.silence_ms

    def update(self, prob: float, stable_text: str = "") -> Optional[str]:
        is_speech = prob >= self.cfg.threshold
        fm = self.cfg.frame_ms

        if self.state == self.WAITING:
            # Debounce onset: require onset_ms of *continuous* speech so a
            # single noisy frame (or a TTS-echo blip) doesn't open a turn.
            self._speech_run_ms = self._speech_run_ms + fm if is_speech else 0
            if self._speech_run_ms >= self.cfg.onset_ms:
                self.state = self.SPEAKING
                self._silence_run_ms = 0
                return "onset"
            return None

        # SPEAKING: count trailing silence; any speech frame resets it.
        if is_speech:
            self._silence_run_ms = 0
        else:
            self._silence_run_ms += fm
        if self._silence_run_ms >= self._silence_budget(stable_text):
            self.reset()
            return "endpoint"
        return None
