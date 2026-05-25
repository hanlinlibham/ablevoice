"""Intent classification — route polished user text to one of:

    chat            (default — fall through to normal chat pipeline)
    ws_list         "我有什么工作区"
    ws_switch       "切到 X 工作区" — switch + clear conversation
    ws_create       "新建一个 X 工作区"
    ws_move         "把对话搬到 X 工作区" — switch but keep local history
    ws_leave        "退出工作区" — back to default sandbox

The classifier is a small LLM call (qwen-flash by default, ~500ms) — but
gated behind a regex pre-filter so 90% of normal-chat turns pay zero
extra latency.

Public surface: ``process_intent(text, session) -> IntentResult``.
"""

from .api import process_intent
from .enums import Intent, IntentResult

__all__ = ["process_intent", "Intent", "IntentResult"]
