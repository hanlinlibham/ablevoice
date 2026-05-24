"""Unit tests for voice.audio — pure functions, no MLX, no I/O.

These run on every ``pytest`` invocation; they're the canary for
``voice/audio.py`` regressions. Add a new case here whenever the
sentence splitter or markdown stripper changes behaviour.
"""

from __future__ import annotations

import io
import wave

import numpy as np
import pytest

from voice.audio import (
    pcm_float_to_wav_bytes,
    pop_speakable,
    strip_markdown_inline,
    strip_terminated_links_and_urls,
    strip_tts_unfriendly,
    wrap_pcm_int16_as_wav,
)


# --- sentence splitter ------------------------------------------------------

class TestPopSpeakable:
    """STRICT-SENTENCE policy: only split at 。!?\\n. Earlier pause-split
    fallback (split at comma when buf > 24-40 chars) was removed — it
    fragmented sentences and TTS prosody suffered. We accept slightly
    longer first-audio latency for materially better speech quality."""

    def test_empty_returns_none(self):
        assert pop_speakable("") == (None, "")

    def test_strong_end_splits(self):
        chunk, rest = pop_speakable("这是一个测试句子。继续说下去")
        assert chunk == "这是一个测试句子。"
        assert rest == "继续说下去"

    def test_below_min_chars_returns_none(self):
        # Strong-end at pos 4 is below default min_chars=6.
        chunk, rest = pop_speakable("到家了。下一步")
        assert chunk is None

    def test_long_buffer_without_end_returns_none(self):
        # Pre-strict, this would have pause-split at the comma. Now
        # waits patiently for 。 — quality > latency.
        buf = "今天的天气真的非常不错,我们出去走走吧朋友们继续讲讲今天遇到的事情"
        chunk, rest = pop_speakable(buf)
        assert chunk is None
        assert rest == buf

    def test_force_flushes_remainder(self):
        chunk, rest = pop_speakable("还没说完", force=True)
        assert chunk == "还没说完"
        assert rest == ""

    def test_force_on_whitespace_only(self):
        chunk, rest = pop_speakable("   ", force=True)
        assert chunk is None
        assert rest == ""

    def test_period_in_url_does_not_split(self):
        # The bug that prompted strict-mode: ``.`` inside a URL token
        # used to trigger a split, fragmenting the URL across TTS chunks.
        # Strict-mode + the new strong-pattern (no \\. in it) leaves
        # URLs intact.
        chunk, rest = pop_speakable("访问 https://tw.trip.com/blog 即可")
        assert chunk is None


# --- markdown stripper ------------------------------------------------------

class TestStripMarkdownInline:

    @pytest.mark.parametrize("inp,out", [
        ("**bold**",                "bold"),
        ("*italic*",                "italic"),
        ("`code`",                  "code"),
        ("~~strike~~",              "strike"),
        ("# Header",                " Header"),
        ("plain text",              "plain text"),
        ("[label](http://x)",       "label"),
        ("|a|b|",                   "a, b"),
        # Table stripping flattens to comma-separated cells (newlines
        # get eaten by the \s* in the pipe regex). This is intentional —
        # TTS reads `A, B, 1, 2` naturally, multi-line table is awkward.
        ("| A | B |\n|---|---|\n|1|2|", "A, B, 1, 2"),
        ("",                        ""),
    ])
    def test_golden(self, inp, out):
        assert strip_markdown_inline(inp) == out


# --- WAV packing ------------------------------------------------------------

class TestStripTtsUnfriendly:
    """TTS-bound text — strip / rewrite patterns TTS reads literally."""

    @pytest.mark.parametrize("inp,out", [
        # Ticker with market suffix
        ("贵州茅台 600519.SH",                            "贵州茅台"),
        ("阿里巴巴9988.HK 港股",                          "阿里巴巴 港股"),
        # Paren-wrapped after Chinese
        ("贵州茅台(600519)",                              "贵州茅台"),
        ("中国平安(601318.SH)",                           "中国平安"),
        ("贵州茅台（600519）",                            "贵州茅台"),  # full-width
        # URLs — drop entirely (whitespace then collapsed)
        ("详见 https://tw.trip.com/blog/uefa-champions/", "详见"),
        ("访问 http://x.com 即可",                        "访问 即可"),
        # Markdown links — keep text only
        ("[欧冠赛程](https://tw.trip.com/blog/x/)",       "欧冠赛程"),
        ("参考 [文档](https://example.com)",              "参考 文档"),
        # Parens-wrapped English (any length) after Chinese
        ("阿森纳 (Arsenal)",                              "阿森纳"),
        ("巴黎圣日耳曼 (Paris Saint-Germain, PSG)",       "巴黎圣日耳曼"),
        # English short ticker after Chinese phrase
        ("苹果公司 AAPL 涨了",                            "苹果公司 涨了"),
        # Dates: M/D and Y/M/D — slash or dash separator
        ("决赛定于 5/31 举行",                            "决赛定于 5月31日 举行"),
        ("活动是 2026/5/31 的事",                         "活动是 2026年5月31日 的事"),
        ("11-30 截止",                                    "11月30日 截止"),
        # Plain numbers must SURVIVE — only confident patterns strip
        ("2026 年第一季度",                               "2026 年第一季度"),
        ("营收增长 25%",                                  "营收增长 25%"),
        ("第 (1) 项",                                     "第 (1) 项"),
        # Structural symbols — bullets, range dashes, leftover slashes
        ("- 欧冠赛程 - 决赛",                             "欧冠赛程 决赛"),
        ("项 / 类",                                       "项 类"),
        # Word-internal hyphen survives
        ("Microsoft-Word 文档",                           "Microsoft-Word 文档"),
        # Markdown leftovers
        ("**重要** ~~过期~~ 提示",                        "重要 过期 提示"),
        # The user-reported end-to-end case — now no dash/slash artifacts
        (
            "参考来源:- [欧冠赛程 - 5/31决赛](https://tw.trip.com/blog/uefa-champions/)",
            "参考来源: 欧冠赛程 5月31日决赛",
        ),
        ("",                                              ""),
    ])
    def test_golden(self, inp, out):
        assert strip_tts_unfriendly(inp) == out


class TestStripTerminatedLinksAndUrls:
    """Buffer-level stripper called per-delta in the chat pipeline.
    Only strips patterns that have at least one char after them — so a
    growing buffer doesn't pre-eat a URL while more chars are still
    arriving."""

    def test_complete_md_link_with_trailing_text_stripped(self):
        assert (
            strip_terminated_links_and_urls("see [docs](http://x.com) please")
            == "see docs please"
        )

    def test_md_link_at_end_left_alone(self):
        """Right at end of buffer — might still be growing. Don't strip."""
        assert (
            strip_terminated_links_and_urls("see [docs](http://x.com)")
            == "see [docs](http://x.com)"
        )

    def test_complete_url_with_trailing_text_stripped(self):
        assert (
            strip_terminated_links_and_urls("访问 https://example.com 即可")
            == "访问  即可"
        )

    def test_url_at_end_left_alone(self):
        assert (
            strip_terminated_links_and_urls("访问 https://example.com")
            == "访问 https://example.com"
        )

    def test_partial_md_link_no_change(self):
        assert strip_terminated_links_and_urls("see [doc") == "see [doc"
        assert strip_terminated_links_and_urls("see [doc](http") == "see [doc](http"

    def test_empty(self):
        assert strip_terminated_links_and_urls("") == ""


class TestPcmFloatToWavBytes:

    def test_roundtrip_int16_payload(self):
        # Sine-ish float32 → WAV → re-decode → expect same length, similar amp.
        samples = np.sin(np.linspace(0, 50, 16000, dtype=np.float32)) * 0.4
        wav = pcm_float_to_wav_bytes(samples, 16000)
        assert wav.startswith(b"RIFF")
        with wave.open(io.BytesIO(wav), "rb") as wf:
            assert wf.getnchannels() == 1
            assert wf.getsampwidth() == 2
            assert wf.getframerate() == 16000
            pcm = wf.readframes(wf.getnframes())
        decoded = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768
        # Length is preserved unless we trimmed silence on either end —
        # this signal is non-silent throughout, so it shouldn't shrink.
        assert decoded.size == samples.size

    def test_silence_trim_removes_head_tail(self):
        # 16000 samples = 1s; bracket a 200ms tone with 400ms silence.
        sr = 16000
        sil = np.zeros(int(sr * 0.4), dtype=np.float32)
        tone = np.sin(np.linspace(0, 30, int(sr * 0.2), dtype=np.float32)) * 0.4
        samples = np.concatenate([sil, tone, sil])
        wav = pcm_float_to_wav_bytes(samples, sr)
        with wave.open(io.BytesIO(wav), "rb") as wf:
            n = wf.getnframes()
        # Should be dramatically shorter than the 16000 input (kept_head +
        # tone + kept_tail ≈ 320 + 3200 + 480 = 4000 ≪ 16000).
        assert n < samples.size // 2

    def test_rms_normalise_loud_signal(self):
        # Already loud → gain capped, no clipping.
        samples = np.full(8000, 0.4, dtype=np.float32)  # constant 0.4 ≈ loud
        wav = pcm_float_to_wav_bytes(samples, 8000)
        with wave.open(io.BytesIO(wav), "rb") as wf:
            pcm = wf.readframes(wf.getnframes())
        decoded = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768
        # Should not have clipped to all-1.0; RMS-normalize gain is bounded.
        assert decoded.max() < 0.999

    def test_wrap_pcm_int16_as_wav_header(self):
        pcm = (np.arange(8000, dtype=np.int16) * 100).tobytes()
        wav = wrap_pcm_int16_as_wav(pcm, 16000)
        assert wav.startswith(b"RIFF")
        with wave.open(io.BytesIO(wav), "rb") as wf:
            assert wf.getframerate() == 16000
            assert wf.getnframes() == 8000
