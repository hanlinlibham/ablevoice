"""DraftRecorder — crash-safe buffer for an in-flight recording.

Why this exists
===============
Before this module, a recording session held everything in memory: PCM
frames went straight into the streaming ASR session, the running
partial text lived on the WsSession instance, the final transcript was
only persisted once ``stop_recording`` succeeded. If the WS died (or
server crashed) mid-recording, 5 minutes of speech disappeared.

DraftRecorder takes over the data path
======================================
Every binary PCM frame is appended to ``recordings/draft-<id>.pcm`` in
real time before being forwarded to ASR. Each ASR partial snapshot is
flushed to ``recording_drafts.latest_partial`` so even if ASR's final
``finish()`` call hangs / crashes, we still have running text on disk.

On WS disconnect mid-recording, the row stays ``in_progress``. On the
next server startup, ``db.mark_orphans_interrupted()`` flips them to
``interrupted`` — the recovery UI shows them.

Background fsync
================
We don't fsync per-frame (would tank throughput). The OS buffers and
flushes naturally. For paranoia on long recordings, ``_fsync_loop()``
runs every ``FSYNC_INTERVAL_SEC`` and forces a flush. On normal close
(``finalize`` / ``abort``) we fsync explicitly.

Lifecycle
=========
    DraftRecorder(session_id, sample_rate)
        ↓ .start()                  # opens file, inserts row, starts fsync task
        ↓ .append_pcm(bytes) ...     # repeatedly, from each binary WS frame
        ↓ .update_partial(text) ...  # from ASR on_partial callback
        ↓ .finalize(transcript_id) OR .abort()   # closes file, updates row

Concurrency
===========
One DraftRecorder per WsSession. ``append_pcm`` and ``update_partial``
are called from the same asyncio task (the WS receive loop) so there's
no concurrency on instance state. The fsync task does only ``os.fsync``
on the file descriptor and runs concurrently — Python's file object is
thread-safe for that operation.
"""

from __future__ import annotations

import asyncio
import logging
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from . import db
from .config import settings

logger = logging.getLogger("voice.storage")

FSYNC_INTERVAL_SEC = 10.0
# Eager flush() on each append_pcm — keeps Python's userspace buffer
# in sync with the OS file descriptor, so a concurrent reader (e.g.
# /drafts/{id}/recover called against an in-progress draft, or a
# pre-mortem inspection from sqlite browser) sees the bytes that have
# already been written. Doesn't fsync (that's expensive); only the OS
# write-back queue gets touched. fsync stays on the 10s loop.
#
# Throttle SQLite ``audio_bytes`` writes — every 1s of audio
# (~20 AudioWorklet frames at 50ms each). Keeps /drafts size readout
# fresh enough for "recording in progress" UI without 20 writes/sec.
_DB_SYNC_BYTES_INTERVAL = 32000  # 1s @ 16kHz mono int16 (16000 * 2)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class DraftRecorder:
    def __init__(self, session_id: Optional[str], sample_rate: int):
        self.id = uuid.uuid4().hex
        self.session_id = session_id
        self.sample_rate = sample_rate
        self.pcm_path: Path = settings.storage.audio_dir / f"draft-{self.id}.pcm"
        self.audio_bytes: int = 0
        self._fh = None                                # type: ignore[assignment]
        self._fsync_task: Optional[asyncio.Task] = None
        self._latest_partial: str = ""
        self._closed = False
        self._bytes_since_db_sync: int = 0

    # --- lifecycle ---------------------------------------------------------

    async def start(self) -> None:
        """Create the PCM file and the SQLite row. Idempotent on the
        DraftRecorder instance — calling twice is a programmer error
        (asserts won't fire but state will be wrong)."""
        # ensure_layout() in db.init() created the dir, but be safe.
        self.pcm_path.parent.mkdir(parents=True, exist_ok=True)
        self._fh = self.pcm_path.open("wb")
        started = _now_iso()
        db.create_draft(
            id=self.id,
            session_id=self.session_id,
            started_at=started,
            sample_rate=self.sample_rate,
            pcm_path=str(self.pcm_path),
        )
        self._fsync_task = asyncio.create_task(self._fsync_loop(), name=f"draft-fsync-{self.id[:8]}")
        logger.info("draft started id=%s session=%s path=%s",
                    self.id[:8], (self.session_id or "?")[:8], self.pcm_path.name)

    def append_pcm(self, pcm_bytes: bytes) -> None:
        """Write a PCM frame to disk. Synchronous (file I/O is fast, no
        need for executor) — called from the WS receive loop, runs
        before the asyncio.create_task that does ASR feed, so this never
        delays the ASR pipeline materially.

        Eagerly flush()es Python's userspace buffer to the OS file
        descriptor — does NOT fsync (that's expensive, only the 10s
        loop does it). Without flush, /drafts/{id}/recover on an
        in-progress draft sees a partial/empty file because Python
        attached an 8KB buffer to the file object.
        """
        if self._closed or self._fh is None:
            return
        self._fh.write(pcm_bytes)
        self._fh.flush()
        self.audio_bytes += len(pcm_bytes)
        self._bytes_since_db_sync += len(pcm_bytes)
        # Periodic SQLite update so /drafts row reflects actual size
        # within ~1s. Skips when nothing has changed.
        if self._bytes_since_db_sync >= _DB_SYNC_BYTES_INTERVAL:
            self._bytes_since_db_sync = 0
            try:
                db.update_draft_progress(
                    self.id, self.audio_bytes,
                    self._latest_partial or None, _now_iso(),
                )
            except Exception:
                logger.exception("append-time draft sync failed (continuing)")

    def update_partial(self, text: str) -> None:
        """Record the latest ASR partial. Cheap SQLite UPDATE. Called
        from the ASR on_partial callback."""
        if self._closed:
            return
        if text == self._latest_partial:
            return
        self._latest_partial = text
        try:
            db.update_draft_progress(
                self.id, self.audio_bytes, text, _now_iso(),
            )
        except Exception:  # noqa: BLE001
            # SQLite hiccup shouldn't kill the recording.
            logger.exception("update_draft_progress failed (continuing)")

    async def finalize(self, transcript_id: Optional[str]) -> None:
        """Successful stop_recording path. Marks status=completed,
        links the transcripts row. PCM file is deleted unless
        KEEP_AUDIO=1 (in which case it's archive)."""
        await self._close_fh()
        db.finalize_draft(
            self.id, status="completed",
            transcript_id=transcript_id,
            audio_bytes=self.audio_bytes, updated_at=_now_iso(),
        )
        if not settings.storage.keep_audio:
            self._unlink_pcm()
        logger.info("draft finalized id=%s transcript=%s bytes=%d",
                    self.id[:8], (transcript_id or "?")[:8], self.audio_bytes)

    async def abort(self) -> None:
        """Abnormal exit path — leaves the draft as ``in_progress`` (the
        startup hook on next boot will convert to ``interrupted``). We
        DO close the file handle so OS-buffered bytes hit disk + write
        the final ``audio_bytes`` so /drafts shows the right size."""
        await self._close_fh()
        # Sync audio_bytes one last time — the periodic task may not
        # have caught the final frames + update_partial may never have
        # fired for short / silent recordings.
        try:
            db.update_draft_progress(
                self.id, self.audio_bytes, self._latest_partial or None, _now_iso(),
            )
        except Exception:  # noqa: BLE001
            logger.exception("abort-time draft sync failed (continuing)")
        logger.info("draft aborted id=%s bytes=%d (status stays in_progress; "
                    "next startup will mark interrupted)",
                    self.id[:8], self.audio_bytes)

    # --- internals ---------------------------------------------------------

    async def _close_fh(self) -> None:
        if self._closed:
            return
        self._closed = True
        if self._fsync_task is not None and not self._fsync_task.done():
            self._fsync_task.cancel()
            try:
                await self._fsync_task
            except (asyncio.CancelledError, Exception):
                pass
            self._fsync_task = None
        if self._fh is not None:
            try:
                self._fh.flush()
                os.fsync(self._fh.fileno())
            except Exception:
                pass
            try:
                self._fh.close()
            except Exception:
                pass
            self._fh = None

    def _unlink_pcm(self) -> None:
        try:
            self.pcm_path.unlink(missing_ok=True)
        except Exception:
            logger.exception("failed to unlink %s", self.pcm_path)

    async def _fsync_loop(self) -> None:
        """Periodic fsync + audio_bytes sync. fsync because OS write-
        back can be lazy on a busy box; audio_bytes sync because we
        don't write to SQLite on every PCM frame (would be ~20 writes/s
        on AudioWorklet's 50ms chunks)."""
        try:
            while True:
                await asyncio.sleep(FSYNC_INTERVAL_SEC)
                if self._fh is None or self._closed:
                    return
                try:
                    self._fh.flush()
                    os.fsync(self._fh.fileno())
                except Exception:
                    logger.exception("periodic fsync failed (continuing)")
                # Sync row state — picks up bytes the user appended
                # since the last update_partial.
                try:
                    db.update_draft_progress(
                        self.id, self.audio_bytes,
                        self._latest_partial or None, _now_iso(),
                    )
                except Exception:
                    logger.exception("periodic draft sync failed (continuing)")
        except asyncio.CancelledError:
            return
