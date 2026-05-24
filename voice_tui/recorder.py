"""Mic recording.

InputStream callback runs on PortAudio's audio thread; we hand PCM
frames to the asyncio loop via a dedicated bounded asyncio.Queue +
sender task instead of one ``asyncio.create_task`` per frame (which
created ~20 task objects per second).

Public surface:

    rec = Recorder(loop, mic_sr, mic_block, on_level)
    await rec.start(send_pcm_async)   # send_pcm_async is `await ws.send(bytes)`
    ...                                # PCM flows in the background
    await rec.stop()                   # returns peak RMS for the session

``on_level(level, peak)`` is called from the asyncio loop on each
chunk, throttled to one update per frame (50ms by default). Wire it
to the MicMeter widget's reactives.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Awaitable, Callable, Optional

import numpy as np
import sounddevice as sd

from .config import PCM_QUEUE_SIZE
from .devices import resolve_input_device

log = logging.getLogger("tui.recorder")

LevelCallback = Callable[[float, float], None]                 # (level, peak)
PcmSender = Callable[[bytes], Awaitable[None]]                 # awaitable that sends one chunk


class Recorder:
    def __init__(
        self,
        loop: asyncio.AbstractEventLoop,
        sample_rate: int,
        blocksize: int,
        on_level: LevelCallback,
    ):
        self._loop = loop
        self._sr = sample_rate
        self._block = blocksize
        self._on_level = on_level
        self._stream: Optional[sd.InputStream] = None
        self._send_task: Optional[asyncio.Task] = None
        self._pcm_q: Optional[asyncio.Queue[bytes]] = None
        self._peak: float = 0.0
        self._dropped: int = 0

    @property
    def peak(self) -> float:
        return self._peak

    @property
    def dropped(self) -> int:
        return self._dropped

    @property
    def active(self) -> bool:
        return self._stream is not None

    async def start(self, send_pcm: PcmSender) -> None:
        """Open the InputStream and start the PCM sender task. ``send_pcm``
        is awaited once per chunk; if it raises (e.g. WS closed), the
        frame is dropped but recording continues so reconnect can pick
        up where we left off."""
        if self._stream is not None:
            return
        self._peak = 0.0
        self._dropped = 0
        self._pcm_q = asyncio.Queue(maxsize=PCM_QUEUE_SIZE)
        device = resolve_input_device()

        def cb(indata, frames, time_info, status_in):
            # PortAudio audio thread — runs on its own thread, must
            # marshal to the asyncio loop via call_soon_threadsafe.
            ch = indata[:, 0]
            rms = float(np.sqrt(np.mean(ch * ch)))
            if rms > self._peak:
                self._peak = rms
            pcm16 = (np.clip(ch, -1.0, 1.0) * 32767.0).astype(np.int16).tobytes()
            try:
                self._loop.call_soon_threadsafe(self._enqueue, pcm16, rms)
            except RuntimeError:
                # Loop closing — drop frame silently.
                pass

        try:
            self._stream = sd.InputStream(
                samplerate=self._sr, channels=1, dtype="float32",
                blocksize=self._block, callback=cb, device=device,
            )
            self._stream.start()
        except Exception:
            log.exception("InputStream start failed")
            self._stream = None
            raise
        # Dedicated sender — one coroutine pulls from the queue and
        # awaits send_pcm. Beats N=20/sec create_task overhead.
        self._send_task = asyncio.create_task(
            self._sender_loop(send_pcm), name="pcm-sender",
        )

    def _enqueue(self, pcm: bytes, rms: float) -> None:
        """Marshal a PCM chunk + level update from the audio thread
        into the asyncio loop. Non-blocking put — drops the frame if
        queue is full (back-pressure on a stuck WS)."""
        try:
            self._on_level(rms, self._peak)
        except Exception:
            pass
        if self._pcm_q is None:
            return
        try:
            self._pcm_q.put_nowait(pcm)
        except asyncio.QueueFull:
            self._dropped += 1
            if self._dropped == 1 or self._dropped % 50 == 0:
                log.warning("PCM queue full — dropped %d frame(s)", self._dropped)

    async def _sender_loop(self, send_pcm: PcmSender) -> None:
        """Pulls PCM chunks off the queue and awaits ``send_pcm`` for
        each. Exits when queue is closed (None sentinel) or task is
        cancelled."""
        assert self._pcm_q is not None
        try:
            while True:
                pcm = await self._pcm_q.get()
                if pcm is None:  # sentinel
                    return
                try:
                    await send_pcm(pcm)
                except Exception:
                    # WS closed or other transient — swallow, keep
                    # recording. Reconnect logic re-establishes the WS;
                    # frames sent during the outage are lost but the
                    # draft file on the server has its part captured.
                    pass
        except asyncio.CancelledError:
            return

    async def stop(self) -> float:
        """Stop the InputStream + drain the sender task. Returns the
        peak RMS observed (0..1)."""
        if self._stream is None:
            return self._peak
        try:
            self._stream.stop()
            self._stream.close()
        except Exception:
            log.exception("stream stop/close failed")
        self._stream = None
        # Signal sender to exit + wait for it. Don't drain remaining
        # PCM — caller may be cancelling a recording, late frames are
        # noise.
        if self._send_task is not None and self._pcm_q is not None:
            try:
                self._pcm_q.put_nowait(None)
            except asyncio.QueueFull:
                self._send_task.cancel()
            try:
                await self._send_task
            except (asyncio.CancelledError, Exception):
                pass
            self._send_task = None
        self._pcm_q = None
        return self._peak
