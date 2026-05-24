"""voice — local-first ASR + LLM + TTS server modules.

Split out of the original monolithic ``server.py``:

    config     — all env vars in one Settings dataclass + validation
    runtime    — single-thread MLX executor + shared httpx client
    db         — SQLite transcripts table CRUD
    audio      — WAV pack, sentence splitter, markdown stripper
    providers  — ASR / LLM / TTS provider implementations behind Protocols
    chat       — streaming chat pipeline (LLM → sentence split → TTS)
    ws         — /ws WebSocket handler
    http       — REST endpoints (/health /transcribe /tts /chat /history)

``server.py`` is the FastAPI entry that wires everything together. Each
module aims to depend only on ``config`` + ``runtime`` + the standard
library; no module reaches across into a sibling's globals.
"""
