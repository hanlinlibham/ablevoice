"""Pure audio + text utilities — no MLX, no network, no globals.

Three groups:

1. ``pcm_float_to_wav_bytes`` — turn float32 [-1,1] PCM into a WAV blob
   with silence trim + RMS normalisation baked in. Used by every TTS
   chunk (both providers) so chunk joins sound consistent.
2. ``pop_speakable`` — peel a sentence off the front of a buffer of
   streaming LLM tokens; the chat pipeline calls this on every delta.
3. ``strip_markdown_inline`` — drop markdown syntax so TTS doesn't try
   to pronounce ``**bold**`` or ``|`` table cells.

All knobs come from ``voice.config.settings`` so they're tunable via env
without touching this file.
"""

from __future__ import annotations

import io
import re
import wave
from typing import Optional

from .config import settings


# --- WAV packing + post-processing ------------------------------------------

def pcm_float_to_wav_bytes(samples, sample_rate: int) -> bytes:
    """Pack a float32 waveform (mx.array or numpy) into a 16-bit PCM WAV
    blob the browser can play via an <audio> element. mlx-audio yields
    float audio in [-1, 1]; we clip + quantize to int16 here so the
    client doesn't have to know about MLX or float PCM.

    Two post-processing passes:
      1. Trim leading + trailing silence — Qwen3-TTS pads ~80-100ms of
         silence at each end; concatenating chunks with these built-in
         pauses creates audible ⏸ between sentences.
      2. RMS normalise so back-to-back chunks come out at the same
         volume (Qwen3-TTS swings several dB chunk-to-chunk otherwise).
    """
    import numpy as np  # noqa: PLC0415 — heavy import on first TTS call only

    t = settings.tts
    arr = np.asarray(samples, dtype=np.float32).reshape(-1)
    arr = np.clip(arr, -1.0, 1.0)

    # 1. Silence trim. Threshold expressed in dBFS for intuitive tuning.
    if arr.size:
        thresh = 10 ** (t.trim_dbfs / 20)  # e.g. -40 dBFS → 0.01
        mask = np.abs(arr) > thresh
        if mask.any():
            first = int(np.argmax(mask))
            last = arr.size - int(np.argmax(mask[::-1]))  # exclusive
            head_keep = int(t.keep_head_ms * sample_rate / 1000)
            tail_keep = int(t.keep_tail_ms * sample_rate / 1000)
            start = max(0, first - head_keep)
            end = min(arr.size, last + tail_keep)
            arr = arr[start:end]

    # 2. RMS normalise (skip near-silent buffers — boosting them just
    # amplifies model noise).
    rms = float(np.sqrt(np.mean(arr ** 2))) if arr.size else 0.0
    if rms > 5e-4:
        gain = min(t.target_rms / rms, t.max_gain)
        arr = arr * gain
        np.clip(arr, -1.0, 1.0, out=arr)

    pcm16 = (arr * 32767.0).astype(np.int16)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)  # 16-bit
        wf.setframerate(sample_rate)
        wf.writeframes(pcm16.tobytes())
    return buf.getvalue()


def wrap_pcm_int16_as_wav(pcm_bytes: bytes, sample_rate: int) -> bytes:
    """Cheaply wrap raw int16 LE PCM in a WAV header (44 bytes). Used
    when we need a playable file path for mlx-qwen3-asr (ffmpeg loader)
    or for KEEP_AUDIO=1 archiving."""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm_bytes)
    return buf.getvalue()


# --- Sentence splitter ------------------------------------------------------

# Punctuation that ends a "speakable chunk". Two tiers:
#   1. STRONG end (period/?/!) — definitely a sentence boundary.
#   2. PAUSE   (comma/colon/semicolon/、) — used to cut the FIRST chunk
#      aggressively so first-audio latency is short. Later chunks wait
#      for STRONG so cadence sounds natural.
SENTENCE_STRONG_PATTERN = re.compile(r"[。!?!?\.\n]+")
SENTENCE_PAUSE_PATTERN = re.compile(r"[,,;;::、]+")


def pop_speakable(
    buf: str,
    force: bool = False,
    is_first: bool = False,
) -> tuple[Optional[str], str]:
    """Try to peel a speakable chunk off the front of ``buf``.

    Returns ``(chunk, remainder)``. ``chunk`` is None if nothing should
    be flushed yet (waiting for more tokens). With ``force=True``,
    flushes whatever is left (called at end-of-stream).

    Policy (revised — see CHAT_FIRST_SOFT_CAP comment in config):
      1. Always try strong-end punct (。!?) first. A full sentence sounds
         the most natural to splice with the next.
      2. Only if the buffer has grown past the cap do we fall back to a
         pause-level (,, ;) split — this lets the TTS see enough of a
         sentence to render coherent prosody before we cut.
    """
    if not buf:
        return None, buf
    if force:
        return (buf, "") if buf.strip() else (None, "")

    s = settings.sentence
    min_chars = s.first_min_chars if is_first else s.min_chars
    soft_cap = s.first_soft_cap if is_first else s.soft_cap

    # 1. Strong end found anywhere — split there (best joint quality).
    m = SENTENCE_STRONG_PATTERN.search(buf, min_chars)
    if m:
        end = m.end()
        return buf[:end], buf[end:]

    # 2. Wait until cap before resorting to pause-split.
    if len(buf) >= soft_cap:
        mp = SENTENCE_PAUSE_PATTERN.search(buf[:soft_cap], min_chars)
        if mp:
            return buf[: mp.end()], buf[mp.end():]
        # No pause inside cap either — hard cut. Last resort, rare in
        # normal text.
        return buf[:soft_cap], buf[soft_cap:]

    # 3. Otherwise wait for more tokens.
    return None, buf


# --- Markdown stripper (TTS hygiene) ----------------------------------------

_MD_STRIP_RE = re.compile(r"[*`_~#]+")     # bold/italic/code/strikethrough/headers
_MD_LINK_RE = re.compile(r"\[([^\]]+)\]\([^)]+\)")  # [text](url) → text
# Markdown table support — tables come out as ``| a | b |`` lines plus
# a separator row ``|---|---|``. TTS would either stutter on pipes or
# read "vertical bar". We replace pipes with a comma (so cells read as
# a natural list) and drop runs of 3+ dashes (the separator row
# collapses to whitespace). Numbered list markers (``1. ``) are left
# alone — TTS reads them fine and they help structure the speech.
_MD_TABLE_PIPE_RE = re.compile(r"\s*\|\s*")
_MD_RULE_RE = re.compile(r"-{3,}")


def strip_markdown_inline(s: str) -> str:
    """Lightweight per-delta markdown stripper for TTS-bound text.

    Handles inline emphasis (``**bold**``, ``*italic*``, `` `code` ``),
    headers (``#``), links (``[text](url)`` → ``text``) and markdown
    tables (``|`` → ``,``, ``---`` separator rows → blank). We don't
    do full markdown parsing — just enough to keep TTS from
    mispronouncing the syntax characters.
    """
    s = _MD_LINK_RE.sub(r"\1", s)
    s = _MD_RULE_RE.sub("", s)           # before pipe-strip so " |---| " becomes " | | "
    s = _MD_TABLE_PIPE_RE.sub(", ", s)   # cells become comma-separated
    # Comma-cleanup: leading, double, and trailing (before EOL or EOS).
    s = re.sub(r"^[,\s]+", "", s, flags=re.MULTILINE)
    s = re.sub(r",\s*(?=[,\n])", "", s)
    s = re.sub(r",\s*$", "", s, flags=re.MULTILINE)
    s = _MD_STRIP_RE.sub("", s)
    return s


# --- TTS speakability cleanup ----------------------------------------------
#
# LLMs (especially the ablework agent which doesn't honour our
# SYSTEM_PROMPT) emit stock codes / tickers / file paths inline like
# "贵州茅台 600519.SH" or "贵州茅台(600519)". TTS then reads
# "六〇〇五一九点 SH" character by character which is unlistenable.
#
# We strip the most-confidently-recognised patterns BEFORE handing the
# sentence to TTS. The chat history (text shown in UI) keeps the
# original — only the audio path is cleaned. Conservative: only strip
# when the pattern is unambiguous (has a market suffix, or is paren-
# wrapped after a Chinese word) so plain numbers like "2026年" survive.

# 4-6 digits with a .XX or .XXX suffix (e.g. 600519.SH, AAPL.US).
_TICKER_WITH_SUFFIX = re.compile(r"\s?\d{3,6}\.[A-Za-z]{2,3}\b")
# (123456) or (123456.SH) or (123) after a Chinese character — the
# Chinese-anchor prevents stripping bullet numbers like "(1) 第一项".
_TICKER_IN_PARENS = re.compile(
    r"([一-鿿])\s*[(（]\s*\d{3,6}(?:\.[A-Za-z]{2,3})?\s*[)）]"
)
# Common English-abbrev pattern after a Chinese phrase: 苹果公司 AAPL
# → keep "苹果公司". 3-5 all-caps letters that immediately follow a
# Chinese run with at most one space. Anchored on Chinese to avoid
# eating legit English in mostly-English replies.
_ENGLISH_TICKER = re.compile(r"([一-鿿])\s+([A-Z]{3,5})\b")


def strip_tts_unfriendly(s: str) -> str:
    """Remove patterns TTS reads character-by-character. Conservative —
    only confidently-recognised stock codes / English tickers.

    Order matters: PARENS first so we strip the WHOLE wrapper (parens
    + digits + suffix) atomically; otherwise WITH_SUFFIX would consume
    the ``.SH`` part inside and leave an empty ``()`` behind.
    """
    s = _TICKER_IN_PARENS.sub(r"\1", s)
    s = _TICKER_WITH_SUFFIX.sub("", s)
    s = _ENGLISH_TICKER.sub(r"\1", s)
    return s
