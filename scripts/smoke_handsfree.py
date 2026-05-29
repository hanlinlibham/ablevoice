"""Hands-free (VAD-driven) end-to-end smoke.

Boots no server itself — point it at a running instance (ideally local MLX
ASR so no creds are needed)::

    ASR_PROVIDER=mlx MLX_QWEN_MODEL=Qwen/Qwen3-ASR-0.6B POLISH_ENABLED=0 \
      INTENT_ENABLED=0 LLM_PROVIDER=ollama TTS_PROVIDER=dashscope \
      .venv/bin/uvicorn server:app --port 8501 &
    .venv/bin/python scripts/smoke_handsfree.py

What it exercises (no real microphone needed): it streams a fixture WAV
through the /ws hands-free path exactly like the browser worklet would —
0.4s lead silence, the speech, then trailing silence — and asserts the
server's VAD pipeline fires the full turn:

    start_handsfree → vad_state:listening
      (speech)       → vad_state:speech (onset)  + asr_partial(s)
      (trailing sil) → transcript (non-empty)    + vad_state:endpoint
                     → vad_state:listening (ready for the next turn)

The chat that the endpoint kicks off is irrelevant here (LLM is pointed at
a dead ollama on purpose) — we judge success on onset + transcript +
endpoint and quit. Exits non-zero if any of those three is missing.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import wave
from pathlib import Path

import websockets

ROOT = Path(__file__).resolve().parent.parent
FIXTURE = ROOT / "tests" / "fixtures" / "test_zh.wav"

FRAME_SAMPLES = 800           # 50ms @ 16kHz — matches demo-ui/public/pcm-worklet.js
FRAME_BYTES = FRAME_SAMPLES * 2


def load_pcm16(path: Path) -> bytes:
    w = wave.open(str(path))
    assert w.getframerate() == 16000, f"need 16kHz, got {w.getframerate()}"
    assert w.getnchannels() == 1, "need mono"
    assert w.getsampwidth() == 2, "need int16"
    data = w.readframes(w.getnframes())
    w.close()
    return data


def silence(seconds: float) -> bytes:
    return b"\x00\x00" * int(16000 * seconds)


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="ws://127.0.0.1:8501/ws")
    ap.add_argument("--lead", type=float, default=0.4)
    ap.add_argument("--trail", type=float, default=2.0)  # > silence_ms_long so endpoint always fires
    args = ap.parse_args()

    speech = load_pcm16(FIXTURE)
    got = {"listening": 0, "onset": False, "partials": 0, "transcript": None, "endpoint": False}

    async with websockets.connect(args.url, max_size=None) as ws:
        await ws.send(json.dumps({"type": "hello", "session_id": "hf-smoke"}))
        await ws.send(json.dumps({"type": "start_handsfree", "sample_rate": 16000}))

        done = asyncio.Event()

        async def reader() -> None:
            try:
                async for msg in ws:
                    if not isinstance(msg, str):
                        continue
                    ev = json.loads(msg)
                    t = ev.get("type")
                    if t == "vad_state":
                        st = ev.get("state")
                        got[st] = got.get(st, 0) + 1 if st == "listening" else got.get(st, 0)
                        if st == "speech":
                            got["onset"] = True
                        elif st == "endpoint":
                            got["endpoint"] = True
                        print(f"  vad_state: {st}")
                    elif t == "asr_partial":
                        got["partials"] += 1
                    elif t == "transcript":
                        got["transcript"] = ev.get("text")
                        print(f"  transcript: {ev.get('text')!r}  ({ev.get('ms')}ms)")
                    elif t == "handsfree_started":
                        print("  handsfree_started")
                    elif t == "error":
                        print(f"  error: {ev.get('where')}: {ev.get('message')}")
                    # success as soon as the turn closed with a transcript
                    if got["onset"] and got["transcript"] is not None and got["endpoint"]:
                        done.set()
            except websockets.ConnectionClosed:
                pass

        rt = asyncio.create_task(reader())

        async def stream(data: bytes) -> None:
            for i in range(0, len(data), FRAME_BYTES):
                await ws.send(data[i:i + FRAME_BYTES])
                await asyncio.sleep(0.05)  # real-time cadence, like the browser

        print(f"[stream] {args.lead}s silence → {len(speech) / 2 / 16000:.2f}s speech → {args.trail}s silence")
        await stream(silence(args.lead))
        await stream(speech)
        await stream(silence(args.trail))

        try:
            await asyncio.wait_for(done.wait(), timeout=20)
        except asyncio.TimeoutError:
            print("  (timed out waiting for onset+transcript+endpoint)")

        await ws.send(json.dumps({"type": "stop_handsfree"}))
        await asyncio.sleep(0.3)
        rt.cancel()

    text = (got["transcript"] or "").strip()
    passed = got["onset"] and bool(text) and got["endpoint"]
    print(f"\nRESULT: {'PASS' if passed else 'FAIL'}  "
          f"onset={got['onset']} partials={got['partials']} "
          f"transcript={text!r} endpoint={got['endpoint']} "
          f"listening_events={got['listening']}")
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
