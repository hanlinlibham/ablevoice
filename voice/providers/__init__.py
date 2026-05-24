"""Provider implementations behind small Protocols.

Each stage (ASR / LLM / TTS) has a Protocol in ``base`` and one impl
per provider. The chat pipeline + WS handler import via the factory
functions at the bottom of this file — never reach into a specific
provider module — so adding a new backend means dropping a new class
plus extending the factory's match.
"""

from .base import (
    AsrSession,
    LlmProvider,
    TtsProvider,
    get_asr,
    get_llm,
    get_tts,
)

__all__ = [
    "AsrSession",
    "LlmProvider",
    "TtsProvider",
    "get_asr",
    "get_llm",
    "get_tts",
]
