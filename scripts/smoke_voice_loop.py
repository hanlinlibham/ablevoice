"""End-to-end smoke test for the refactored voice server.

Boots no server itself — point ``--url`` at a running instance:

    .venv/bin/uvicorn server:app --port 8501 &
    .venv/bin/python scripts/smoke_voice_loop.py

Exercises (in order):

    1. GET /health                — config + provider report
    2. POST /transcribe           — file upload path (mlx ASR)
    3. POST /tts                  — one-shot TTS round-trip
    4. POST /chat (SSE)           — token + audio_chunk + done events
    5. WS /ws — full voice loop   — hello → start_recording → PCM frames →
       stop_recording → transcript → meta/token/audio_chunk/chat_done
       (also exercises interrupt by sending one mid-stream)

Exits non-zero if any step fails. Designed to be run after the Tier B
refactor to confirm we didn't regress the wire-level behavior.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
import uuid
import wave
from pathlib import Path

import httpx
import websockets


ROOT = Path(__file__).resolve().parent.parent
FIXTURE = ROOT / "tests" / "fixtures" / "test_zh.wav"


def ok(msg: str) -> None:
    print(f"  ✓ {msg}")


def fail(msg: str) -> None:
    print(f"  ✗ {msg}", file=sys.stderr)
    sys.exit(1)


# --- step 1: health ---------------------------------------------------------

def step_health(http_base: str) -> dict:
    print("[1] GET /health")
    r = httpx.get(f"{http_base}/health", timeout=10)
    r.raise_for_status()
    h = r.json()
    if not h.get("ok"):
        fail(f"health not ok: {h}")
    ok(f"asr={h['asr_provider']}({h['asr_model_id']})")
    ok(f"llm={h['llm_provider']}({h['llm_model_id']})")
    ok(f"tts={h['tts_provider']}({h['tts_model_id']}, voice={h['tts_voice']})")
    return h


# --- step 2: /transcribe ----------------------------------------------------

def step_transcribe(http_base: str) -> None:
    print("[2] POST /transcribe (test_zh.wav)")
    with FIXTURE.open("rb") as f:
        r = httpx.post(
            f"{http_base}/transcribe",
            files={"audio": ("test_zh.wav", f, "audio/wav")},
            data={"peak_level": "0.5"},
            timeout=60,
        )
    r.raise_for_status()
    j = r.json()
    text = (j.get("text") or "").strip()
    if not text:
        fail(f"empty transcript: {j}")
    ok(f"text={text!r}  ms={j['ms']}  bytes={j['audio_bytes']}")


# --- step 3: /tts -----------------------------------------------------------

def step_tts(http_base: str) -> None:
    print("[3] POST /tts")
    r = httpx.post(
        f"{http_base}/tts",
        json={"text": "你好,我在测试语音回路。"},
        timeout=60,
    )
    r.raise_for_status()
    body = r.content
    if not (body.startswith(b"RIFF") and len(body) > 1000):
        fail(f"bad TTS response: {len(body)} bytes head={body[:8]!r}")
    ok(f"wav {len(body)} bytes  dur={r.headers.get('X-TTS-Duration-Ms')}ms")


# --- step 4: /chat SSE ------------------------------------------------------

def step_chat_sse(http_base: str) -> None:
    print("[4] POST /chat (SSE)")
    sid = "smoke-" + uuid.uuid4().hex[:6]
    seen = {"token": 0, "audio": 0, "done": 0, "error": 0}
    full_text = []
    t0 = time.monotonic()
    first_audio_ms = None

    with httpx.stream(
        "POST", f"{http_base}/chat",
        json={"session_id": sid, "text": "用一句话介绍你自己。"},
        timeout=60,
    ) as r:
        if r.status_code != 200:
            fail(f"chat HTTP {r.status_code}: {r.read()[:200]!r}")
        event = None
        for line in r.iter_lines():
            line = line.strip() if isinstance(line, str) else line.decode("utf-8", "replace").strip()
            if not line:
                event = None
                continue
            if line.startswith("event:"):
                event = line[len("event:"):].strip()
            elif line.startswith("data:"):
                data = line[len("data:"):].strip()
                if event in seen:
                    seen[event] += 1
                try:
                    payload = json.loads(data)
                except json.JSONDecodeError:
                    continue
                if event == "token":
                    full_text.append(payload.get("delta", ""))
                elif event == "audio" and first_audio_ms is None:
                    first_audio_ms = int((time.monotonic() - t0) * 1000)
                elif event == "error":
                    fail(f"chat error event: {payload}")
                elif event == "done":
                    ok(f"done full_text={''.join(full_text)[:60]!r} total_ms={payload.get('total_ms')}")
    if seen["error"]:
        fail(f"chat saw {seen['error']} error events")
    if seen["token"] == 0:
        fail("no token events")
    if seen["audio"] == 0:
        fail("no audio_chunk events")
    if seen["done"] == 0:
        fail("no done event")
    ok(f"events: token={seen['token']} audio={seen['audio']} done=1  first_audio={first_audio_ms}ms")


# --- step 5: /ws full voice loop -------------------------------------------

async def step_ws(ws_base: str) -> None:
    print("[5] WS /ws (PCM upload + chat pipeline)")
    sid = "smoke-ws-" + uuid.uuid4().hex[:6]

    # Load fixture as 16kHz int16 PCM (already is).
    with wave.open(str(FIXTURE), "rb") as wf:
        sr = wf.getframerate()
        pcm = wf.readframes(wf.getnframes())
    if sr != 16000:
        fail(f"fixture expected 16kHz, got {sr}")

    seen = {
        "ready": 0, "asr_partial": 0, "transcript": 0,
        "meta": 0, "token": 0, "audio_chunk": 0,
        "chat_done": 0, "error": 0, "interrupted": 0,
    }
    transcript_text = None
    chat_full_text = []
    first_audio_ms = None
    t_recording_done = None

    async with websockets.connect(f"{ws_base}/ws", max_size=None) as ws:
        await ws.send(json.dumps({"type": "hello", "session_id": sid}))
        await ws.send(json.dumps({"type": "start_recording", "sample_rate": 16000}))

        # Stream PCM in 50ms chunks (matching the AudioWorklet cadence).
        chunk_bytes = int(0.05 * sr) * 2  # 50ms of int16 mono
        for i in range(0, len(pcm), chunk_bytes):
            await ws.send(pcm[i : i + chunk_bytes])
            await asyncio.sleep(0.02)  # don't burst — let ASR partials breathe

        await ws.send(json.dumps({"type": "stop_recording", "peak_level": 0.5}))

        t_start = time.monotonic()
        # Read until chat_done (or error / timeout).
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=deadline - time.monotonic())
            except asyncio.TimeoutError:
                fail("ws timed out waiting for chat_done")
            if isinstance(raw, bytes):
                continue
            ev = json.loads(raw)
            t = ev.get("type")
            if t in seen:
                seen[t] += 1
            if t == "transcript":
                transcript_text = (ev.get("text") or "").strip()
                t_recording_done = time.monotonic()
                ok(f"transcript={transcript_text!r} ms={ev['ms']}")
            elif t == "token":
                chat_full_text.append(ev.get("delta", ""))
            elif t == "audio_chunk" and first_audio_ms is None:
                if t_recording_done is not None:
                    first_audio_ms = int((time.monotonic() - t_recording_done) * 1000)
            elif t == "error":
                fail(f"ws error: {ev}")
            elif t == "chat_done":
                ok(f"chat_done text={''.join(chat_full_text)[:60]!r} total_ms={ev['total_ms']}")
                break

    if seen["transcript"] == 0:
        fail("no transcript event")
    if not transcript_text:
        fail("transcript text empty")
    if seen["chat_done"] == 0:
        fail("no chat_done")
    if seen["audio_chunk"] == 0:
        fail("no audio_chunk")
    ok(
        f"events: ready={seen['ready']} partials={seen['asr_partial']} "
        f"tokens={seen['token']} audio={seen['audio_chunk']} "
        f"first_audio_after_stop={first_audio_ms}ms"
    )


# --- step 6: /ws interrupt --------------------------------------------------

async def step_ws_interrupt(ws_base: str) -> None:
    """Confirm interrupt cancels a running chat and we get the
    ``interrupted`` event back."""
    print("[6] WS /ws interrupt (cancel mid-chat)")
    sid = "smoke-int-" + uuid.uuid4().hex[:6]

    with wave.open(str(FIXTURE), "rb") as wf:
        sr = wf.getframerate()
        pcm = wf.readframes(wf.getnframes())

    async with websockets.connect(f"{ws_base}/ws", max_size=None) as ws:
        await ws.send(json.dumps({"type": "hello", "session_id": sid}))
        await ws.send(json.dumps({"type": "start_recording", "sample_rate": 16000}))
        chunk_bytes = int(0.05 * sr) * 2
        for i in range(0, len(pcm), chunk_bytes):
            await ws.send(pcm[i : i + chunk_bytes])
            await asyncio.sleep(0.02)
        await ws.send(json.dumps({"type": "stop_recording", "peak_level": 0.5}))

        # Wait until first audio chunk arrives, then send interrupt.
        deadline = time.monotonic() + 30
        sent_interrupt = False
        saw_interrupted = False
        chunks_before_interrupt = 0
        while time.monotonic() < deadline:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=deadline - time.monotonic())
            except asyncio.TimeoutError:
                fail("interrupt test timed out")
            if isinstance(raw, bytes):
                continue
            ev = json.loads(raw)
            t = ev.get("type")
            if t == "error":
                fail(f"ws error: {ev}")
            if t == "audio_chunk":
                chunks_before_interrupt += 1
                if not sent_interrupt:
                    t0 = time.monotonic()
                    await ws.send(json.dumps({"type": "interrupt"}))
                    sent_interrupt = True
            if t == "interrupted":
                saw_interrupted = True
                latency_ms = int((time.monotonic() - t0) * 1000)
                ok(f"interrupted reason={ev.get('reason')!r}  latency={latency_ms}ms  "
                   f"chunks_before={chunks_before_interrupt}")
                break
            if t == "chat_done" and not sent_interrupt:
                # Chat finished before we ever heard audio — fallback: send
                # interrupt anyway and we'll re-test on a longer reply.
                ok("chat finished before first audio (short reply) — skipping interrupt check")
                return
        if not saw_interrupted:
            fail("never received interrupted event")


# --- runner -----------------------------------------------------------------

async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://127.0.0.1:8501",
                    help="server base URL (http://host:port)")
    ap.add_argument("--skip-interrupt", action="store_true",
                    help="skip the interrupt test (it depends on a long-enough reply)")
    args = ap.parse_args()
    http_base = args.url.rstrip("/")
    ws_base = http_base.replace("https://", "wss://", 1).replace("http://", "ws://", 1)

    step_health(http_base)
    step_transcribe(http_base)
    step_tts(http_base)
    step_chat_sse(http_base)
    await step_ws(ws_base)
    if not args.skip_interrupt:
        await step_ws_interrupt(ws_base)

    print("\nALL CHECKS PASSED")


if __name__ == "__main__":
    asyncio.run(main())
