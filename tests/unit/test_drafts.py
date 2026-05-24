"""Draft persistence — DB CRUD + DraftRecorder file lifecycle.

Uses tmp_path for both the SQLite DB and the recordings dir so the
real demo data isn't touched.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from pathlib import Path

import pytest

from voice import db
from voice.config import settings
from voice.storage import DraftRecorder


def _iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@pytest.fixture()
def tmp_storage(tmp_path, monkeypatch):
    """Both the DB and the audio dir get redirected to tmp_path. Frozen
    dataclass → ``object.__setattr__`` trick (consistent with test_db)."""
    storage = settings.storage
    original_db = storage.db_path
    original_audio = storage.audio_dir
    object.__setattr__(storage, "db_path", tmp_path / "t.db")
    object.__setattr__(storage, "audio_dir", tmp_path / "recordings")
    storage.audio_dir.mkdir(exist_ok=True)
    db.init()
    yield tmp_path
    object.__setattr__(storage, "db_path", original_db)
    object.__setattr__(storage, "audio_dir", original_audio)


class TestDraftsCrud:

    def test_create_and_get(self, tmp_storage):
        db.create_draft(
            id="d1", session_id="s1", started_at=_iso(),
            sample_rate=16000, pcm_path=str(tmp_storage / "r" / "d1.pcm"),
        )
        row = db.get_draft("d1")
        assert row is not None
        assert row["status"] == "in_progress"
        assert row["audio_bytes"] == 0
        assert row["latest_partial"] is None

    def test_update_progress_partial_and_bytes(self, tmp_storage):
        db.create_draft(
            id="d2", session_id=None, started_at=_iso(),
            sample_rate=16000, pcm_path="/tmp/d2.pcm",
        )
        db.update_draft_progress("d2", audio_bytes=1024,
                                 latest_partial="正在说话", updated_at=_iso())
        row = db.get_draft("d2")
        assert row["audio_bytes"] == 1024
        assert row["latest_partial"] == "正在说话"

    def test_list_filters_by_status(self, tmp_storage):
        db.create_draft(id="a", session_id=None, started_at=_iso(),
                        sample_rate=16000, pcm_path="/tmp/a")
        db.create_draft(id="b", session_id=None, started_at=_iso(),
                        sample_rate=16000, pcm_path="/tmp/b")
        db.finalize_draft("a", status="completed",
                          transcript_id="t1", audio_bytes=100, updated_at=_iso())
        assert {r["id"] for r in db.list_drafts(status="in_progress")} == {"b"}
        assert {r["id"] for r in db.list_drafts(status="completed")} == {"a"}
        # No filter → both
        assert {r["id"] for r in db.list_drafts()} == {"a", "b"}

    def test_mark_orphans_interrupted(self, tmp_storage):
        db.create_draft(id="x", session_id=None, started_at=_iso(),
                        sample_rate=16000, pcm_path="/tmp/x")
        db.create_draft(id="y", session_id=None, started_at=_iso(),
                        sample_rate=16000, pcm_path="/tmp/y")
        # finalize y so only x is orphan
        db.finalize_draft("y", status="completed", transcript_id="t",
                          audio_bytes=10, updated_at=_iso())
        n = db.mark_orphans_interrupted(_iso())
        assert n == 1
        assert db.get_draft("x")["status"] == "interrupted"
        assert db.get_draft("y")["status"] == "completed"

    def test_delete_returns_pcm_path(self, tmp_storage):
        db.create_draft(id="z", session_id=None, started_at=_iso(),
                        sample_rate=16000, pcm_path="/tmp/zz.pcm")
        p = db.delete_draft("z")
        assert p == "/tmp/zz.pcm"
        assert db.get_draft("z") is None

    def test_delete_missing_returns_none(self, tmp_storage):
        assert db.delete_draft("nope") is None


class TestDraftRecorder:

    def test_full_lifecycle_completed_keeps_no_audio(self, tmp_storage):
        async def run():
            r = DraftRecorder(session_id="s", sample_rate=16000)
            await r.start()
            r.append_pcm(b"\x00\x01" * 1000)
            r.append_pcm(b"\x02\x03" * 1000)
            r.update_partial("partial text")
            await r.finalize(transcript_id="trans-abc")
            return r

        rec = asyncio.run(run())
        row = db.get_draft(rec.id)
        assert row["status"] == "completed"
        assert row["transcript_id"] == "trans-abc"
        assert row["audio_bytes"] == 4000
        # KEEP_AUDIO is off by default → pcm should be deleted on finalize
        assert not rec.pcm_path.exists()

    def test_abort_leaves_row_in_progress_and_file_on_disk(self, tmp_storage):
        async def run():
            r = DraftRecorder(session_id=None, sample_rate=16000)
            await r.start()
            r.append_pcm(b"\x10\x11" * 500)
            await r.abort()
            return r

        rec = asyncio.run(run())
        row = db.get_draft(rec.id)
        assert row["status"] == "in_progress"  # waiting for orphan sweep
        assert rec.pcm_path.exists()
        # File contents = what we appended (no header — raw PCM)
        assert rec.pcm_path.stat().st_size == 1000

    def test_update_partial_no_change_is_noop(self, tmp_storage):
        async def run():
            r = DraftRecorder(session_id=None, sample_rate=16000)
            await r.start()
            r.append_pcm(b"\xaa" * 16)
            r.update_partial("hello")
            r.update_partial("hello")  # duplicate — should not re-write
            r.update_partial("hello world")
            await r.abort()
            return r

        rec = asyncio.run(run())
        row = db.get_draft(rec.id)
        assert row["latest_partial"] == "hello world"
        assert row["audio_bytes"] == 16

    def test_keep_audio_finalize_preserves_file(self, tmp_storage, monkeypatch):
        # Flip KEEP_AUDIO via dataclass override — same trick as DB path.
        object.__setattr__(settings.storage, "keep_audio", True)
        try:
            async def run():
                r = DraftRecorder(session_id=None, sample_rate=16000)
                await r.start()
                r.append_pcm(b"\x55" * 200)
                await r.finalize(transcript_id="tx")
                return r
            rec = asyncio.run(run())
            assert rec.pcm_path.exists()
            assert rec.pcm_path.stat().st_size == 200
        finally:
            object.__setattr__(settings.storage, "keep_audio", False)
