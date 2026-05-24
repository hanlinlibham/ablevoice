"""Polish — 把 ASR 口语转写整理成准确书面文本。

LangGraph 小 agent,5 节点:classify → (should_polish?) → polish → validate
→ (retry or finalize) → END。详见 ``graph.py``。

Public surface:

    from voice.polish import polish_text
    result = await polish_text("呃 帮我看下今天那个联想集团 最新财报")
    # result.final  → "帮我看下联想集团今天的最新财报。"
    # result.skipped → False
    # result.attempts → 1

V1 是 dynamic prompt 的最小版 — 只有 classify(规则)+ base prompt + validate
+ retry,没有领域 vocab / 会话上下文。后续加 dynamic 轴的扩展点都留在
``prompts.build_messages()`` 内部。
"""

from .api import PolishResult, polish_text

__all__ = ["PolishResult", "polish_text"]
