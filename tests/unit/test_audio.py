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
    strip_tts_unfriendly,
    wrap_pcm_int16_as_wav,
)


# --- sentence splitter ------------------------------------------------------

class TestPopSpeakable:
    """Two-tier punctuation policy:

      1. STRONG end (。!?) splits anywhere past ``min_chars``.
      2. PAUSE (,, ;) only kicks in past ``soft_cap``.
      3. Below cap with no strong end → return None (wait for more).
    """

    def test_empty_returns_none(self):
        assert pop_speakable("") == (None, "")

    def test_strong_end_splits(self):
        # SENTENCE_STRONG_PATTERN.search(buf, min_chars=6) — needs the
        # punctuation to be at position >= 6, so 5 chars before 。 is
        # below the threshold. Use a buffer long enough to clear it.
        chunk, rest = pop_speakable("这是一个测试句子。继续说下去")
        assert chunk == "这是一个测试句子。"
        assert rest == "继续说下去"

    def test_below_cap_no_strong_returns_none(self):
        # 10 chars, no strong punct, below default soft_cap (40)
        chunk, rest = pop_speakable("一个比较长的句子开头中")
        assert chunk is None
        assert rest == "一个比较长的句子开头中"

    def test_force_flushes_remainder(self):
        chunk, rest = pop_speakable("还没说完", force=True)
        assert chunk == "还没说完"
        assert rest == ""

    def test_force_on_whitespace_only(self):
        chunk, rest = pop_speakable("   ", force=True)
        assert chunk is None
        assert rest == ""

    def test_first_chunk_uses_first_caps(self):
        # First-chunk soft_cap defaults to 24; build a >24 char buffer
        # with no strong end so the pause-split kicks in.
        buf = "今天的天气真的非常不错,我们出去走走吧朋友们"  # 22 chars, has comma at pos 12
        chunk, rest = pop_speakable(buf, is_first=False)  # soft_cap=40, won't trigger
        assert chunk is None
        # With is_first=True and soft_cap=24, length 22 < 24 → still None
        chunk, rest = pop_speakable(buf, is_first=True)
        assert chunk is None
        # Past the first cap → pause-split.
        longer = buf + "继续讲讲今天遇到的事情"
        chunk, rest = pop_speakable(longer, is_first=True)
        assert chunk is not None
        assert chunk.endswith(",")


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
    """TTS-bound text — strip codes that TTS reads character by character."""

    @pytest.mark.parametrize("inp,out", [
        # ticker with market suffix — strip wholesale
        ("贵州茅台 600519.SH",   "贵州茅台"),
        ("阿里巴巴9988.HK 港股",  "阿里巴巴 港股"),  # also catches no-space
        # paren-wrapped after Chinese — strip code, keep Chinese
        ("贵州茅台(600519)",      "贵州茅台"),
        ("中国平安(601318.SH)",   "中国平安"),
        ("贵州茅台（600519）",     "贵州茅台"),  # full-width parens too
        # English ticker after Chinese phrase
        ("苹果公司 AAPL 涨了",     "苹果公司 涨了"),
        # Plain numbers must SURVIVE — only confident patterns strip
        ("2026 年第一季度",        "2026 年第一季度"),
        ("营收增长 25%",           "营收增长 25%"),
        ("第 (1) 项",              "第 (1) 项"),     # bullet number not after Chinese run
        ("",                       ""),
    ])
    def test_golden(self, inp, out):
        assert strip_tts_unfriendly(inp) == out


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
