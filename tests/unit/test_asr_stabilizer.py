"""Unit tests for DashScope ASR partial stabilization (LocalAgreement-2).

The cloud ASR doesn't expose a stable_text field, so we run a tiny client-
side stabilizer: a prefix that appears in two consecutive partials gets
``committed`` and is rendered in normal weight; the tail past the commit
stays tentative (UI shows dimmed) until it survives another partial.

We test the pure prefix helper directly and the simulated rolling sequence
through a tiny adapter that mirrors ``DashscopeRealtimeAsr._reader``'s
commit logic.
"""

from __future__ import annotations

from voice.providers.asr import _build_run_task_payload, _common_prefix


class TestCommonPrefix:
    def test_empty_either(self):
        assert _common_prefix("", "abc") == ""
        assert _common_prefix("abc", "") == ""
        assert _common_prefix("", "") == ""

    def test_full_match(self):
        assert _common_prefix("hello", "hello") == "hello"

    def test_prefix_match(self):
        assert _common_prefix("今天天气", "今天天气真好") == "今天天气"
        assert _common_prefix("今天天气真好", "今天天气") == "今天天气"

    def test_no_match(self):
        assert _common_prefix("早上好", "你好") == ""

    def test_partial_match(self):
        assert _common_prefix("今天天气真好", "今天天气不错") == "今天天气"

    def test_single_char_match(self):
        assert _common_prefix("a", "ab") == "a"


# --- Simulated rolling-partial sequence -----------------------------------
#
# Mirrors the LocalAgreement-2 commit rule in DashscopeRealtimeAsr._reader:
#   agreement = lcp(prev_partial, cur_partial)
#   if len(agreement) > len(committed): committed = agreement
# Monotone: once committed, a later partial cannot retract it.


def _run_stabilizer(partials: list[str]) -> list[tuple[str, str]]:
    """Drive a sequence of partials through the LocalAgreement-2 stabilizer
    and return ``[(cur_partial, committed_text), ...]`` after each step."""
    out = []
    prev = ""
    committed = ""
    for cur in partials:
        if cur == prev:
            continue
        agreement = _common_prefix(prev, cur)
        if len(agreement) > len(committed):
            committed = agreement
        out.append((cur, committed))
        prev = cur
    return out


class TestLocalAgreement2:
    def test_monotone_growth(self):
        seq = _run_stabilizer([
            "今天",
            "今天天气",
            "今天天气真好",
            "今天天气真好啊",
        ])
        # After step 1: no prior, committed stays empty
        # After step 2: lcp("今天", "今天天气") = "今天" → committed
        # After step 3: lcp("今天天气", "今天天气真好") = "今天天气" → committed grows
        # After step 4: lcp("今天天气真好", "今天天气真好啊") = "今天天气真好"
        committeds = [c for _, c in seq]
        assert committeds == ["", "今天", "今天天气", "今天天气真好"]

    def test_rewrite_does_not_retract_committed(self):
        # Model rewrites the tail mid-stream. Once a prefix has appeared
        # in two consecutive partials, it MUST stay committed even if a
        # later rewrite no longer agrees on later chars.
        seq = _run_stabilizer([
            "今天天气",                 # partial 1
            "今天天气真不错",            # partial 2 → commit "今天天气"
            "明天再说吧",                # full rewrite — lcp with prev = ""
        ])
        committeds = [c for _, c in seq]
        # Step 3: lcp("今天天气真不错", "明天再说吧") = "" which is shorter
        # than committed "今天天气" — commit must NOT shrink.
        assert committeds == ["", "今天天气", "今天天气"]

    def test_full_disagreement_keeps_committed_empty(self):
        seq = _run_stabilizer(["你好", "早上好"])
        # lcp("你好", "早上好") = "" → committed unchanged (was "")
        assert seq == [("你好", ""), ("早上好", "")]

    def test_dedup_identical_partial(self):
        # Identical re-emit should be skipped — matches real producer
        # which only forwards when text changes.
        seq = _run_stabilizer(["今天天气", "今天天气", "今天天气真好"])
        assert seq == [
            ("今天天气", ""),
            ("今天天气真好", "今天天气"),
        ]

    def test_first_partial_has_no_prior_so_no_commit(self):
        seq = _run_stabilizer(["第一句话来了"])
        # First partial has nothing to agree with — committed must stay ""
        # UI renders the whole thing as tentative.
        assert seq == [("第一句话来了", "")]


class TestRunTaskPayload:
    """The run-task JSON sent to DashScope inference WS. Wire-shape pinned
    here because both paraformer-realtime-v2 and qwen3-asr-flash-realtime
    are addressed through the same provider class — the only safe variant
    is which hotword field gets populated."""

    def test_minimal_payload_shape(self):
        p = _build_run_task_payload(
            model="paraformer-realtime-v2", sample_rate=16000,
            lang="zh", task_id="abc",
        )
        assert p["header"] == {
            "action": "run-task", "task_id": "abc", "streaming": "duplex",
        }
        body = p["payload"]
        assert body["task_group"] == "audio"
        assert body["task"] == "asr"
        assert body["function"] == "recognition"
        assert body["model"] == "paraformer-realtime-v2"
        assert body["parameters"] == {
            "sample_rate": 16000, "format": "pcm", "language_hints": ["zh"],
        }
        assert body["input"] == {}

    def test_paraformer_vocabulary_id_lands_in_parameters(self):
        p = _build_run_task_payload(
            model="paraformer-realtime-v2", sample_rate=16000,
            lang="zh", task_id="abc",
            vocabulary_id="vocab-asr-ablv-123",
        )
        assert p["payload"]["parameters"]["vocabulary_id"] == "vocab-asr-ablv-123"
        # Context route stays empty for paraformer
        assert p["payload"]["input"] == {}

    def test_qwen3_context_lands_in_input(self):
        p = _build_run_task_payload(
            model="qwen3-asr-flash-realtime", sample_rate=16000,
            lang="zh", task_id="abc",
            context="Technical terms: 宁德时代, 科创50",
        )
        assert p["payload"]["input"] == {
            "context": "Technical terms: 宁德时代, 科创50",
        }
        # Vocabulary route stays empty for qwen3
        assert "vocabulary_id" not in p["payload"]["parameters"]

    def test_both_hotword_routes_coexist(self):
        # Setting both is safe — each model ignores the other's field.
        p = _build_run_task_payload(
            model="paraformer-realtime-v2", sample_rate=16000,
            lang="zh", task_id="abc",
            vocabulary_id="vocab-asr-ablv-123",
            context="Technical terms: X, Y",
        )
        assert p["payload"]["parameters"]["vocabulary_id"] == "vocab-asr-ablv-123"
        assert p["payload"]["input"]["context"] == "Technical terms: X, Y"

    def test_empty_strings_skip_hotword_fields(self):
        # Explicit empty strings (the default env value) must NOT inject
        # ``vocabulary_id=""`` / ``context=""`` into the payload — that
        # would override good behavior with junk.
        p = _build_run_task_payload(
            model="paraformer-realtime-v2", sample_rate=16000,
            lang="zh", task_id="abc",
            vocabulary_id="", context="",
        )
        assert "vocabulary_id" not in p["payload"]["parameters"]
        assert p["payload"]["input"] == {}
