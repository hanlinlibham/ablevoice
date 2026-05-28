"""Unit tests for voice.meta_commands — the deterministic fast-path that
bypasses polish + LLM intent classify for short utterances like "停" or
"慢点".

Gates that must hold for a match:
  - duration_ms <= MAX_DURATION_MS
  - len(stripped text) <= MAX_TEXT_LEN
  - text matches one of the anchored regex patterns
"""

from __future__ import annotations

import pytest

from voice.meta_commands import MAX_DURATION_MS, MAX_TEXT_LEN, MetaCommand, match


class TestMatch:
    @pytest.mark.parametrize("text,cmd", [
        ("停", MetaCommand.STOP),
        ("停下", MetaCommand.STOP),
        ("暂停", MetaCommand.STOP),
        ("停止", MetaCommand.STOP),
        ("别说了", MetaCommand.STOP),
        ("继续", MetaCommand.RESUME),
        ("接着说", MetaCommand.RESUME),
        ("重说", MetaCommand.REPLAY),
        ("再说一遍", MetaCommand.REPLAY),
        ("慢点", MetaCommand.SLOWER),
        ("慢一点", MetaCommand.SLOWER),
        ("说慢点", MetaCommand.SLOWER),
        ("快点", MetaCommand.FASTER),
        ("大声点", MetaCommand.LOUDER),
        ("大点声", MetaCommand.LOUDER),
        ("小声点", MetaCommand.QUIETER),
    ])
    def test_known_commands(self, text, cmd):
        m = match(text, duration_ms=800)
        assert m is not None
        assert m.command == cmd
        assert m.ack_text  # non-empty ack

    @pytest.mark.parametrize("text", [
        "停下手头的工作",   # too long — contains command word but isn't one
        "再讲一下今天的事",  # contains "讲" but full sentence
        "请帮我做点事",     # plain chat
        "你好",            # short but not a command
        "我想问个问题",
    ])
    def test_non_command_falls_through(self, text):
        assert match(text, duration_ms=800) is None

    def test_long_text_gate_blocks_match(self):
        # Even if a substring is a command pattern, len > MAX_TEXT_LEN
        # means the user clearly said more than just "停下".
        text = "停下" * 5    # 10 chars, repeats — not a command
        assert len(text) > MAX_TEXT_LEN
        assert match(text, duration_ms=800) is None

    def test_long_duration_gate_blocks_match(self):
        # Recording 3s long can't plausibly be a single-word command
        # even if it transcribed to "停" (ASR noise / dropouts).
        assert match("停", duration_ms=MAX_DURATION_MS + 1) is None

    def test_trailing_punctuation_stripped(self):
        # ASR sometimes adds 。 or ! to short utterances — both should hit.
        assert match("停。", duration_ms=500).command == MetaCommand.STOP
        assert match("慢点!", duration_ms=500).command == MetaCommand.SLOWER
        assert match("继续,", duration_ms=500).command == MetaCommand.RESUME

    def test_empty_input(self):
        assert match("", duration_ms=500) is None
        assert match("   ", duration_ms=500) is None

    def test_whitespace_only_after_strip(self):
        assert match(" 。 ! ", duration_ms=500) is None

    def test_negative_duration_treated_as_zero(self):
        # Edge case: clock skew / partial recording — still allow match.
        assert match("停", duration_ms=0).command == MetaCommand.STOP

    def test_command_word_inside_longer_phrase_does_not_match(self):
        # "停车场在哪" contains "停" but is not a STOP command.
        # Gate already drops it (too long), but verifies the anchored
        # regex would too if length passed.
        assert match("停车场在哪", duration_ms=800) is None
