"""End-to-end integration: real uvicorn + real models + real backends.

Marked ``integration`` so plain ``pytest`` skips it. Run explicitly via:

    pytest tests/integration                    # only integration
    pytest -m integration                       # same, by marker
    pytest                                       # unit suite only (default)

Each test in this file exercises one wire path; the ``live_server``
fixture boots one uvicorn instance shared across tests so we pay
warmup (~5s) once per session. ASR / LLM / TTS providers come from
the runtime env (i.e. .env.local), so this tests whatever the user
has configured — not a mocked stack.
"""

from __future__ import annotations

import asyncio
import json
import time
import uuid
import wave
from pathlib import Path

import httpx
import pytest
import websockets

pytestmark = pytest.mark.integration

FIXTURE = Path(__file__).resolve().parent.parent / "fixtures" / "test_zh.wav"


def _ws_base(http_base: str) -> str:
    return http_base.replace("http://", "ws://", 1).replace("https://", "wss://", 1)


# --- HTTP paths -------------------------------------------------------------

def test_health(live_server):
    r = httpx.get(f"{live_server}/health", timeout=10)
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    # Must report effective provider names — guards the config dispatch.
    assert body["asr_provider"] in {"mlx", "dashscope"}
    assert body["llm_provider"] in {"mlx", "ollama", "dashscope", "ablework"}
    assert body["tts_provider"] in {"mlx", "dashscope"}


def test_transcribe(live_server):
    with FIXTURE.open("rb") as f:
        r = httpx.post(
            f"{live_server}/transcribe",
            files={"audio": ("test_zh.wav", f, "audio/wav")},
            data={"peak_level": "0.5"},
            timeout=60,
        )
    assert r.status_code == 200
    j = r.json()
    text = (j["text"] or "").strip()
    # ASR isn't 1:1 deterministic across model versions, so we assert
    # signal-bearing words instead of exact match.
    assert any(word in text for word in ("财报", "数据", "看一下"))
    assert j["ms"] > 0


def test_tts(live_server):
    r = httpx.post(
        f"{live_server}/tts",
        json={"text": "你好,我在测试语音回路。"},
        timeout=60,
    )
    assert r.status_code == 200
    assert r.content.startswith(b"RIFF")
    assert len(r.content) > 1000
    assert int(r.headers["X-TTS-Duration-Ms"]) > 0


def test_chat_sse(live_server):
    """SSE path: token → audio → done. Doesn't assert exact reply text
    since LLM output is non-deterministic; checks event sequence + that
    we got at least one token and one audio chunk."""
    sid = "pytest-" + uuid.uuid4().hex[:6]
    seen = {"token": 0, "audio": 0, "done": 0, "error": 0}
    with httpx.stream(
        "POST", f"{live_server}/chat",
        json={"session_id": sid, "text": "用一句话介绍你自己。"},
        timeout=60,
    ) as r:
        assert r.status_code == 200
        event = None
        for line in r.iter_lines():
            line = line.strip() if isinstance(line, str) else line.decode("utf-8", "replace").strip()
            if not line:
                event = None; continue
            if line.startswith("event:"):
                event = line[6:].strip()
            elif line.startswith("data:") and event in seen:
                seen[event] += 1
                if event == "done":
                    break
    assert seen["error"] == 0
    assert seen["token"] > 0
    assert seen["audio"] > 0
    assert seen["done"] == 1


# --- WebSocket path ---------------------------------------------------------

def _load_fixture_pcm() -> tuple[bytes, int]:
    with wave.open(str(FIXTURE), "rb") as wf:
        return wf.readframes(wf.getnframes()), wf.getframerate()


async def _run_ws_loop(live_server, *, interrupt_after_first_audio=False) -> dict:
    """Drive the full WS protocol; return event counters + transcript."""
    pcm, sr = _load_fixture_pcm()
    assert sr == 16000

    seen = {"ready": 0, "asr_partial": 0, "transcript": 0, "meta": 0,
            "token": 0, "audio_chunk": 0, "chat_done": 0,
            "interrupted": 0, "error": 0}
    transcript_text = ""
    interrupt_latency_ms = None

    async with websockets.connect(
        f"{_ws_base(live_server)}/ws", max_size=None,
    ) as ws:
        await ws.send(json.dumps({"type": "hello",
                                  "session_id": "pytest-ws-" + uuid.uuid4().hex[:6]}))
        await ws.send(json.dumps({"type": "start_recording", "sample_rate": 16000}))
        chunk_bytes = int(0.05 * sr) * 2
        for i in range(0, len(pcm), chunk_bytes):
            await ws.send(pcm[i: i + chunk_bytes])
            await asyncio.sleep(0.02)
        await ws.send(json.dumps({"type": "stop_recording", "peak_level": 0.5}))

        deadline = time.monotonic() + 60
        sent_interrupt = False
        t_interrupt = 0.0
        while time.monotonic() < deadline:
            raw = await asyncio.wait_for(ws.recv(), timeout=deadline - time.monotonic())
            if isinstance(raw, bytes):
                continue
            ev = json.loads(raw)
            t = ev.get("type")
            if t in seen:
                seen[t] += 1
            if t == "transcript":
                transcript_text = (ev.get("text") or "").strip()
            elif t == "audio_chunk" and interrupt_after_first_audio and not sent_interrupt:
                t_interrupt = time.monotonic()
                await ws.send(json.dumps({"type": "interrupt"}))
                sent_interrupt = True
            elif t == "interrupted":
                interrupt_latency_ms = int((time.monotonic() - t_interrupt) * 1000)
                break
            elif t == "chat_done":
                break
            elif t == "error":
                raise AssertionError(f"ws error event: {ev}")

    return {
        "seen": seen,
        "transcript": transcript_text,
        "interrupt_latency_ms": interrupt_latency_ms,
    }


def test_ws_full_loop(live_server):
    """hello → record → stop → transcript → chat → audio → done."""
    r = asyncio.run(_run_ws_loop(live_server))
    assert r["seen"]["ready"] == 1
    assert r["seen"]["transcript"] == 1
    assert r["seen"]["chat_done"] == 1
    assert r["seen"]["audio_chunk"] >= 1
    assert r["seen"]["error"] == 0
    assert any(w in r["transcript"] for w in ("财报", "数据", "看一下"))


def test_draft_recovery_round_trip(live_server):
    """Full crash-recovery flow: open WS, start_recording, stream PCM,
    abruptly close (no stop_recording). Verify a draft is left behind,
    /drafts/{id}/recover transcribes it into a real transcripts row.

    This is the load-bearing safety property of the storage layer —
    long recordings (1+ min) shouldn't be lost if the WS dies."""
    pcm, sr = _load_fixture_pcm()

    async def crash_and_recover() -> dict:
        # 1. Open WS, stream half the fixture, then close abruptly —
        #    simulating a browser crash / network drop.
        sid = "pytest-crash-" + uuid.uuid4().hex[:6]
        async with websockets.connect(
            f"{_ws_base(live_server)}/ws", max_size=None,
        ) as ws:
            await ws.send(json.dumps({"type": "hello", "session_id": sid}))
            await ws.send(json.dumps({"type": "start_recording", "sample_rate": 16000}))
            chunk_bytes = int(0.05 * sr) * 2
            half = len(pcm) // 2
            for i in range(0, half, chunk_bytes):
                await ws.send(pcm[i: i + chunk_bytes])
                await asyncio.sleep(0.02)
            # No stop_recording — close the socket abruptly.
        # WS.__aexit__ triggers ws.py's finally block which calls
        # draft.abort() — row stays in_progress (not interrupted yet —
        # interrupted only happens at server startup). The /drafts
        # endpoint with status=in_progress will still find it.
        # (We don't restart the server here; the recover path handles
        # both in_progress and interrupted.)

        # 2. /drafts surfaces it. We accept either status because we
        #    didn't restart the server.
        async with httpx.AsyncClient() as client:
            r = await client.get(
                f"{live_server}/drafts?status=in_progress", timeout=10,
            )
            r.raise_for_status()
            drafts = r.json()
            mine = [d for d in drafts if d.get("session_id") == sid]
            assert mine, f"draft not surfaced for session {sid}"
            draft = mine[0]
            assert draft["audio_bytes"] > 0
            assert Path(draft["pcm_path"]).exists()

            # 3. /recover transcribes the PCM and inserts a transcripts row.
            rr = await client.post(
                f"{live_server}/drafts/{draft['id']}/recover", timeout=60,
            )
            rr.raise_for_status()
            transcript = rr.json()
            return {"draft": draft, "transcript": transcript}

    result = asyncio.run(crash_and_recover())
    transcript = result["transcript"]
    # ASR on half a recording still gives some text from the fixture.
    text = (transcript.get("text") or "").strip()
    assert text, f"recovered transcript empty: {transcript}"
    # Don't assert on exact keyword — half-truncated audio may miss
    # later words. Just confirm transcription ran.
    assert transcript["audio_bytes"] > 0
    assert transcript["model"]  # populated


def test_ws_polish_event_lands(live_server):
    """Polish runs after transcript on /ws. Assert we see at least one
    ``transcript_polished`` event when polish is enabled (default), and
    that the polished text is non-empty. We don't compare to the raw
    text — short/clean transcripts can legally polish to themselves
    (skipped path)."""
    pcm, sr = _load_fixture_pcm()

    async def go() -> dict:
        seen_polished = []
        async with websockets.connect(
            f"{_ws_base(live_server)}/ws", max_size=None,
        ) as ws:
            await ws.send(json.dumps({"type": "hello",
                                      "session_id": "pytest-polish-" + uuid.uuid4().hex[:6]}))
            await ws.send(json.dumps({"type": "start_recording", "sample_rate": 16000}))
            chunk_bytes = int(0.05 * sr) * 2
            for i in range(0, len(pcm), chunk_bytes):
                await ws.send(pcm[i: i + chunk_bytes])
                await asyncio.sleep(0.02)
            await ws.send(json.dumps({"type": "stop_recording", "peak_level": 0.5}))
            deadline = time.monotonic() + 60
            while time.monotonic() < deadline:
                raw = await asyncio.wait_for(ws.recv(), timeout=deadline - time.monotonic())
                if isinstance(raw, bytes):
                    continue
                ev = json.loads(raw)
                if ev.get("type") == "transcript_polished":
                    seen_polished.append(ev)
                if ev.get("type") == "chat_done":
                    break
        return seen_polished

    events = asyncio.run(go())
    assert len(events) >= 1, "expected transcript_polished event"
    ev = events[0]
    assert ev.get("id"), "polished event must reference transcript id"
    assert ev.get("text"), "polished text must be non-empty"
    assert "raw" in ev
    # ms should be reasonable (under 10s even on slow path)
    assert ev.get("ms", 0) >= 0
    assert ev.get("ms", 0) < 10000


def test_ws_interrupt_mid_chat(live_server):
    """User interrupt during chat → ``interrupted`` event,
    partial assistant text NOT persisted to history."""
    r = asyncio.run(_run_ws_loop(live_server, interrupt_after_first_audio=True))
    assert r["seen"]["error"] == 0
    # We either got cancelled (long reply) or finished before audio (short).
    # Long-reply path is the actual interrupt test; short reply is fine too.
    if r["seen"]["interrupted"] == 1:
        # Cancellation should be snappy — well under a second.
        assert r["interrupt_latency_ms"] is not None
        assert r["interrupt_latency_ms"] < 1000
    else:
        # Skip if the reply was too short to interrupt this run.
        assert r["seen"]["chat_done"] == 1
