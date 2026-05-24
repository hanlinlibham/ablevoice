"""Unit tests for voice.polish — classify + validators (pure, no LLM).

Graph + LLM dispatch tested via integration suite (needs real model).
"""

from __future__ import annotations

import pytest

from voice.polish.classify import classify
from voice.polish.validators import validate


class TestClassify:

    def test_short_input_marked_too_short(self):
        c = classify("帮我")
        assert c["is_too_short"] is True

    def test_clean_punctuated_marked_too_clean(self):
        c = classify("请帮我查一下联想集团今天的财报。")
        assert c["is_too_clean"] is True
        # Long enough not to count as short.
        assert c["is_too_short"] is False

    def test_rambling_with_fillers_not_clean(self):
        c = classify("呃,帮我看一下今天那个联想集团,嗯,最新财报的情况")
        assert c["is_too_clean"] is False
        assert c["is_too_short"] is False

    def test_question_detection(self):
        assert classify("现在几点了").get("is_question") is True
        assert classify("会议在什么时候开始").get("is_question") is True
        assert classify("好的我知道了").get("is_question") is False

    def test_entity_detection_company_suffix(self):
        assert classify("联想集团今天股价怎么样").get("has_entities") is True
        assert classify("帮我看一下平安银行的财报").get("has_entities") is True
        assert classify("今天天气挺好").get("has_entities") is False

    def test_number_detection(self):
        assert classify("营收增长了 25 个百分点").get("has_numbers") is True
        assert classify("没有数字的句子").get("has_numbers") is False


class TestValidate:

    def test_clean_polish_passes(self):
        v = validate("呃帮我看一下", "帮我看一下。")
        assert v["ok"] is True
        assert v["errors"] == []

    def test_empty_output_fails(self):
        v = validate("有内容", "   ")
        assert v["ok"] is False
        assert "empty_output" in v["errors"]

    @pytest.mark.parametrize("prefix", [
        "好的,", "好的", "整理后:", "以下是", "Sure, here", "OK,",
    ])
    def test_preamble_detected(self, prefix):
        v = validate("呃测试一下", f"{prefix}测试一下。")
        assert "has_preamble" in v["errors"]

    def test_lost_digit_caught(self):
        v = validate("营收增长了 25 个百分点", "营收有所增长。")
        assert any(e.startswith("lost_digit:25") for e in v["errors"])

    def test_digit_preserved_passes(self):
        v = validate("营收增长了 25 个百分点", "营收增长 25 个百分点。")
        assert v["ok"] is True

    def test_runaway_growth_caught(self):
        raw = "查个数据"
        # Polished should not become a paragraph
        polished = "请帮我查询一下今天最新的数据情况," * 5
        v = validate(raw, polished)
        assert "too_long" in v["errors"]

    def test_short_input_not_flagged_too_short_when_polished_similar(self):
        # 4-char raw, 5-char polished — fine.
        v = validate("有问题", "有问题。")
        assert v["ok"] is True
