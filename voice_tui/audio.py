"""AudioStreamer — gap-free chunked TTS playback.

The naive approach is ``sd.play(samples, blocking=True)`` per chunk
inside a worker thread. Each call opens a fresh OutputStream, writes
the samples, and tears it down — costing ~20-50ms setup overhead
between chunks AND giving the OS audio engine a brief underrun, both
of which the user perceives as a "⏸" between sentences.

This class keeps one persistent OutputStream running. New chunks are
appended to a thread-safe deque; the audio-thread callback consumes
from it continuously, padding with zeros when empty. Joining two
consecutive chunks now adds zero scheduling latency — only the silence
that's actually inside the audio data itself (which we trim server-side).
"""

from __future__ import annotations

import collections
import threading

import numpy as np
import sounddevice as sd


class AudioStreamer:
    def __init__(self, sample_rate: int):
        self._sr = sample_rate
        self._buf: "collections.deque[np.ndarray]" = collections.deque()
        self._cur: np.ndarray | None = None
        self._cur_pos = 0
        self._lock = threading.Lock()
        # Running output level (RMS of the last played block), read by the
        # UI to draw a playback waveform. Plain float — single-writer
        # (audio thread) / single-reader (UI), atomic enough for a meter.
        self._level = 0.0
        self._stream = sd.OutputStream(
            samplerate=sample_rate, channels=1, dtype="float32",
            blocksize=512, callback=self._callback,
        )
        self._stream.start()

    def _callback(self, outdata, frames, time_info, status):
        out = outdata[:, 0]
        out.fill(0.0)
        written = 0
        with self._lock:
            while written < frames:
                if self._cur is None:
                    if not self._buf:
                        break
                    self._cur = self._buf.popleft()
                    self._cur_pos = 0
                remaining = self._cur.shape[0] - self._cur_pos
                take = min(remaining, frames - written)
                out[written: written + take] = self._cur[self._cur_pos: self._cur_pos + take]
                self._cur_pos += take
                written += take
                if self._cur_pos >= self._cur.shape[0]:
                    self._cur = None
        # RMS of what we actually played this block, smoothed (fast attack,
        # slow release) so the meter rides the speech envelope instead of
        # strobing at block rate.
        rms = float(np.sqrt(np.mean(np.square(out[:written])))) if written else 0.0
        self._level = rms if rms > self._level else self._level * 0.8 + rms * 0.2

    @property
    def level(self) -> float:
        """Smoothed RMS of the audio currently playing (0..~1)."""
        return self._level

    def enqueue(self, samples: np.ndarray) -> None:
        with self._lock:
            self._buf.append(samples)

    def clear(self) -> None:
        """Stop playback immediately (interrupt / new recording)."""
        with self._lock:
            self._buf.clear()
            self._cur = None
            self._cur_pos = 0

    @property
    def busy(self) -> bool:
        with self._lock:
            return self._cur is not None or len(self._buf) > 0

    def close(self) -> None:
        try:
            self._stream.stop()
            self._stream.close()
        except Exception:
            pass
