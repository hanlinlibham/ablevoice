"""SQLite transcripts table — schema + CRUD helpers.

All queries live here so adding an index / column / migration touches
one place. Connections are short-lived (open per call) because SQLite
on a single-writer demo doesn't benefit from pooling and short-lived
conns avoid lock contention with the warmup task that runs on startup.

We INSERT even on empty text — useful for diagnosing "mic silent →
0 chars" patterns across many runs (see schema comment in CLAUDE.md).
"""

from __future__ import annotations

import logging
import sqlite3
from pathlib import Path
from typing import Optional

from .config import settings

logger = logging.getLogger("voice.db")


def init() -> None:
    """Create the transcripts + recording_drafts tables on first start.
    Idempotent — runs every server startup. ``ALTER TABLE ADD COLUMN``
    handles old DBs that pre-date a column (SQLite has no IF NOT EXISTS
    for columns)."""
    conn = sqlite3.connect(settings.storage.db_path)
    try:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS transcripts (
                id            TEXT PRIMARY KEY,
                created_at    TEXT NOT NULL,
                text          TEXT NOT NULL,
                text_polished TEXT,
                ms            INTEGER NOT NULL,
                audio_bytes   INTEGER NOT NULL,
                peak_level    REAL,
                model         TEXT NOT NULL,
                audio_path    TEXT,
                client_meta   TEXT
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_transcripts_created ON transcripts(created_at)"
        )
        # Recording drafts — captures PCM + latest ASR partial as a
        # recording proceeds, so a 5-min monologue isn't lost on WS
        # disconnect / server crash. ``status`` lifecycle:
        #   in_progress → completed   (stop_recording succeeded)
        #              → interrupted  (WS died / server restart mid-record)
        #              → recovered    (user re-transcribed an interrupted one)
        #              → discarded    (user threw it away)
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS recording_drafts (
                id              TEXT PRIMARY KEY,
                session_id      TEXT,
                started_at      TEXT NOT NULL,
                updated_at      TEXT NOT NULL,
                sample_rate     INTEGER NOT NULL,
                pcm_path        TEXT NOT NULL,
                audio_bytes     INTEGER NOT NULL DEFAULT 0,
                latest_partial  TEXT,
                status          TEXT NOT NULL DEFAULT 'in_progress',
                transcript_id   TEXT
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_drafts_status ON recording_drafts(status)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_drafts_started ON recording_drafts(started_at)"
        )
        # Migrate old DBs (pre-polish era) — add the column if missing.
        cols = {r[1] for r in conn.execute("PRAGMA table_info(transcripts)")}
        if "text_polished" not in cols:
            conn.execute("ALTER TABLE transcripts ADD COLUMN text_polished TEXT")
        conn.commit()
    finally:
        conn.close()


def insert_transcript(
    *,
    id: str,
    created_at: str,
    text: str,
    ms: int,
    audio_bytes: int,
    peak_level: Optional[float],
    model: str,
    audio_path: Optional[str],
    client_meta: Optional[str],
    text_polished: Optional[str] = None,
) -> None:
    conn = sqlite3.connect(settings.storage.db_path)
    try:
        conn.execute(
            """
            INSERT INTO transcripts
                (id, created_at, text, text_polished, ms, audio_bytes, peak_level, model, audio_path, client_meta)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (id, created_at, text, text_polished, ms, audio_bytes,
             peak_level, model, audio_path, client_meta),
        )
        conn.commit()
    finally:
        conn.close()


def update_polished(transcript_id: str, text_polished: str) -> None:
    """Patch the row with polish output. Used by /ws after polish completes
    asynchronously — the row was inserted with text_polished=NULL when the
    transcript event went out."""
    conn = sqlite3.connect(settings.storage.db_path)
    try:
        conn.execute(
            "UPDATE transcripts SET text_polished = ? WHERE id = ?",
            (text_polished, transcript_id),
        )
        conn.commit()
    finally:
        conn.close()


def list_transcripts(limit: int = 50) -> list[dict]:
    """Newest-first, capped 1..500. Used by /history on UI cold load."""
    limit = max(1, min(limit, 500))
    conn = sqlite3.connect(settings.storage.db_path)
    try:
        conn.row_factory = sqlite3.Row
        cur = conn.execute(
            """
            SELECT id, created_at, text, text_polished, ms, audio_bytes,
                   peak_level, model, audio_path
            FROM transcripts
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (limit,),
        )
        return [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()


def delete_transcript(transcript_id: str) -> Optional[str]:
    """Delete one row. Returns the row's audio_path (if any) so caller
    can also remove the file. Returns sentinel ``""`` if no audio was
    kept, or ``None`` if the row didn't exist."""
    conn = sqlite3.connect(settings.storage.db_path)
    try:
        cur = conn.execute(
            "SELECT audio_path FROM transcripts WHERE id = ?", (transcript_id,)
        )
        row = cur.fetchone()
        if row is None:
            return None
        audio_path = row[0]
        conn.execute("DELETE FROM transcripts WHERE id = ?", (transcript_id,))
        conn.commit()
    finally:
        conn.close()
    return audio_path or ""


def ensure_layout() -> None:
    """Create the audio dir if KEEP_AUDIO is on. Logs which path is in
    effect so startup output makes it obvious whether recordings persist.

    Recording-draft PCM files live in the same ``audio_dir`` (always
    created) regardless of KEEP_AUDIO — drafts are crash-recovery
    buffers, not archive."""
    init()
    settings.storage.audio_dir.mkdir(parents=True, exist_ok=True)
    if settings.storage.keep_audio:
        logger.info("KEEP_AUDIO=1 → finalized audio kept in %s", settings.storage.audio_dir)
    else:
        logger.info("KEEP_AUDIO=0 → finalized audio deleted; drafts kept until resolved")


# --- recording_drafts CRUD --------------------------------------------------

def create_draft(
    *,
    id: str,
    session_id: Optional[str],
    started_at: str,
    sample_rate: int,
    pcm_path: str,
) -> None:
    conn = sqlite3.connect(settings.storage.db_path)
    try:
        conn.execute(
            """
            INSERT INTO recording_drafts
                (id, session_id, started_at, updated_at,
                 sample_rate, pcm_path, audio_bytes, status)
            VALUES (?, ?, ?, ?, ?, ?, 0, 'in_progress')
            """,
            (id, session_id, started_at, started_at, sample_rate, pcm_path),
        )
        conn.commit()
    finally:
        conn.close()


def update_draft_progress(
    draft_id: str, audio_bytes: int, latest_partial: Optional[str],
    updated_at: str,
) -> None:
    """Cheap row update — called from the ASR partial callback. Doesn't
    touch the PCM file; that's owned by the DraftRecorder."""
    conn = sqlite3.connect(settings.storage.db_path)
    try:
        conn.execute(
            """
            UPDATE recording_drafts
            SET audio_bytes = ?, latest_partial = ?, updated_at = ?
            WHERE id = ?
            """,
            (audio_bytes, latest_partial, updated_at, draft_id),
        )
        conn.commit()
    finally:
        conn.close()


def finalize_draft(
    draft_id: str, *, status: str, transcript_id: Optional[str],
    audio_bytes: int, updated_at: str,
) -> None:
    """Close out a draft. ``status`` is one of completed / interrupted /
    recovered / discarded. ``transcript_id`` links to the transcripts
    row when status is completed/recovered."""
    conn = sqlite3.connect(settings.storage.db_path)
    try:
        conn.execute(
            """
            UPDATE recording_drafts
            SET status = ?, transcript_id = ?, audio_bytes = ?, updated_at = ?
            WHERE id = ?
            """,
            (status, transcript_id, audio_bytes, updated_at, draft_id),
        )
        conn.commit()
    finally:
        conn.close()


def list_drafts(status: Optional[str] = None, limit: int = 100) -> list[dict]:
    """List drafts, newest first. ``status=None`` returns all states;
    pass ``"interrupted"`` to surface recoverable recordings."""
    conn = sqlite3.connect(settings.storage.db_path)
    try:
        conn.row_factory = sqlite3.Row
        if status:
            cur = conn.execute(
                """
                SELECT * FROM recording_drafts
                WHERE status = ?
                ORDER BY started_at DESC LIMIT ?
                """, (status, limit),
            )
        else:
            cur = conn.execute(
                """
                SELECT * FROM recording_drafts
                ORDER BY started_at DESC LIMIT ?
                """, (limit,),
            )
        return [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()


def get_draft(draft_id: str) -> Optional[dict]:
    conn = sqlite3.connect(settings.storage.db_path)
    try:
        conn.row_factory = sqlite3.Row
        cur = conn.execute(
            "SELECT * FROM recording_drafts WHERE id = ?", (draft_id,),
        )
        row = cur.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def delete_draft(draft_id: str) -> Optional[str]:
    """Delete the row. Returns the pcm_path so the caller can also
    remove the file. Returns ``None`` if the row didn't exist."""
    conn = sqlite3.connect(settings.storage.db_path)
    try:
        cur = conn.execute(
            "SELECT pcm_path FROM recording_drafts WHERE id = ?", (draft_id,),
        )
        row = cur.fetchone()
        if row is None:
            return None
        pcm_path = row[0]
        conn.execute("DELETE FROM recording_drafts WHERE id = ?", (draft_id,))
        conn.commit()
    finally:
        conn.close()
    return pcm_path or ""


def mark_orphans_interrupted(updated_at: str) -> int:
    """At server startup, any draft still marked ``in_progress`` is
    orphaned (the WS that owned it died before stop_recording). Mark
    them ``interrupted`` so the recovery UI can surface them.

    Returns count of rows updated."""
    conn = sqlite3.connect(settings.storage.db_path)
    try:
        cur = conn.execute(
            """
            UPDATE recording_drafts
            SET status = 'interrupted', updated_at = ?
            WHERE status = 'in_progress'
            """, (updated_at,),
        )
        n = cur.rowcount
        conn.commit()
        return n
    finally:
        conn.close()
