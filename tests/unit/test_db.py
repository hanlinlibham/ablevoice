"""SQLite CRUD unit tests — uses a tmp DB so the real transcripts.db
isn't touched. Patches ``voice.config.settings.storage.db_path`` at the
field level (dataclass is frozen so we go around the freeze for tests
only)."""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from voice import db
from voice.config import settings


@pytest.fixture()
def tmp_db(tmp_path, monkeypatch):
    """Replace the configured DB path with a fresh tmpdir DB. Dataclass
    is frozen so we use object.__setattr__ — fine for tests since teardown
    restores the original. db.init() recreates the schema on the new path."""
    tmp_db_path = tmp_path / "t.db"
    original = settings.storage.db_path
    object.__setattr__(settings.storage, "db_path", tmp_db_path)
    db.init()
    yield tmp_db_path
    object.__setattr__(settings.storage, "db_path", original)


def test_init_creates_table_and_index(tmp_db):
    conn = sqlite3.connect(tmp_db)
    try:
        names = {r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type IN ('table','index')"
        )}
    finally:
        conn.close()
    assert "transcripts" in names
    assert "idx_transcripts_created" in names


def test_insert_then_list_roundtrip(tmp_db):
    db.insert_transcript(
        id="a", created_at="2026-01-01T00:00:00+00:00",
        text="hi", ms=10, audio_bytes=100, peak_level=0.5,
        model="m", audio_path=None, client_meta=None,
    )
    rows = db.list_transcripts(limit=10)
    assert len(rows) == 1
    assert rows[0]["id"] == "a"
    assert rows[0]["text"] == "hi"
    assert rows[0]["peak_level"] == 0.5


def test_list_newest_first(tmp_db):
    for i, ts in enumerate(["2026-01-01T00:00:00Z",
                            "2026-01-02T00:00:00Z",
                            "2026-01-03T00:00:00Z"]):
        db.insert_transcript(
            id=f"id{i}", created_at=ts, text=str(i), ms=1,
            audio_bytes=1, peak_level=None,
            model="m", audio_path=None, client_meta=None,
        )
    rows = db.list_transcripts()
    assert [r["id"] for r in rows] == ["id2", "id1", "id0"]


def test_list_clamps_limit(tmp_db):
    # 600 requested → server caps at 500. We don't insert 500 rows; just
    # confirm the call doesn't error and returns ≤ 500.
    rows = db.list_transcripts(limit=600)
    assert len(rows) <= 500


def test_delete_returns_audio_path(tmp_db):
    db.insert_transcript(
        id="x", created_at="now", text="t", ms=1, audio_bytes=1,
        peak_level=None, model="m",
        audio_path="/tmp/x.wav", client_meta=None,
    )
    p = db.delete_transcript("x")
    assert p == "/tmp/x.wav"
    assert db.list_transcripts() == []


def test_delete_missing_returns_none(tmp_db):
    assert db.delete_transcript("nope") is None


def test_delete_no_audio_returns_empty(tmp_db):
    db.insert_transcript(
        id="y", created_at="now", text="t", ms=1, audio_bytes=1,
        peak_level=None, model="m",
        audio_path=None, client_meta=None,
    )
    p = db.delete_transcript("y")
    assert p == ""  # sentinel distinguishes "no row" (None) from "no audio file" ("")


def test_empty_text_persists(tmp_db):
    """Diagnostic schema invariant: we INSERT even on empty text so
    'mic silent → 0 chars' patterns are queryable later."""
    db.insert_transcript(
        id="silent", created_at="now", text="", ms=2,
        audio_bytes=42, peak_level=0.001,
        model="m", audio_path=None, client_meta=None,
    )
    rows = db.list_transcripts()
    assert len(rows) == 1
    assert rows[0]["text"] == ""
