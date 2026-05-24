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
#   1. STRONG end (Chinese 。/!/? + ASCII !/? + newline) — definitely a
#      sentence boundary. We DELIBERATELY don't include bare ``.`` here:
#      it shows up in URLs (``tw.trip.com``), decimal numbers (``2.5亿``),
#      and English abbreviations (``Mr.``), all of which we don't want
#      to split on. English-source sentences accumulate to soft_cap then
#      fall back to pause-split — fine for TTS.
#   2. PAUSE   (comma/colon/semicolon/、) — used to cut the FIRST chunk
#      aggressively so first-audio latency is short. Later chunks wait
#      for STRONG so cadence sounds natural.
SENTENCE_STRONG_PATTERN = re.compile(r"[。!?!?\n]+")
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

    Policy: STRICT-SENTENCE — only flush at strong-end punctuation
    (。!?\\n). Earlier versions had a pause-split fallback (split at
    comma after ~24-40 chars) to cut first-audio latency. That
    fragmented sentences, sending TTS clause-by-clause; the resulting
    prosody felt disjointed because each clause was synthesised without
    seeing the rest of the sentence. We accept slightly slower first-
    audio (a few hundred ms more on long sentences) for materially
    better speech quality.

    The end-of-stream ``force=True`` call still flushes any tail that
    arrived without a closing 。 — so a LLM reply that doesn't end on
    a punctuation mark still gets fully spoken.

    ``is_first`` and ``min_chars`` are kept for compatibility but no
    longer affect the split decision.
    """
    if not buf:
        return None, buf
    if force:
        return (buf, "") if buf.strip() else (None, "")

    s = settings.sentence
    min_chars = s.first_min_chars if is_first else s.min_chars

    # Only strong end-of-sentence punctuation splits. Wait otherwise.
    m = SENTENCE_STRONG_PATTERN.search(buf, min_chars)
    if m:
        end = m.end()
        return buf[:end], buf[end:]
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
# Anything that looks like a URL, dropped wholesale. Stops at whitespace
# or closing brackets so we don't eat trailing Chinese text.
_URL_RE = re.compile(r"https?://[^\s)）\]】>]+")
# Markdown link [text](url) → keep just the text. Used at chunk level
# so a multi-delta link assembled into one chunk gets cleaned.
_MD_LINK_RE = re.compile(r"\[([^\]\n]+)\]\([^)\n]+\)")
# English-in-parens after a Chinese phrase — strip whole paren group
# (covers "(Arsenal)", "(Paris Saint-Germain, PSG)", etc). The
# previous _ENGLISH_TICKER (3-5 chars unparen'd) misses these.
_ENGLISH_IN_PARENS = re.compile(
    r"([一-鿿])\s*[(（]\s*[A-Za-z][A-Za-z0-9 .,'\-]{0,40}\s*[)）]"
)
# Standalone English ticker / abbreviation after Chinese run.
_ENGLISH_TICKER = re.compile(r"([一-鿿])\s+([A-Z]{3,5})\b")
# Dates: "5/31" / "5-31" / "2026/5/31" — TTS reads the slash as
# "斜杠". Normalise to 月日 / 年月日 form so it reads as a date.
# 4-digit year first so we don't half-match.
_DATE_YMD = re.compile(r"\b(\d{4})[/\-](\d{1,2})[/\-](\d{1,2})\b")
_DATE_MD  = re.compile(r"(?<!\d)(\d{1,2})[/\-](\d{1,2})(?!\d)(?!\s*[\-/])")


def strip_tts_unfriendly(s: str) -> str:
    """Remove / rewrite patterns TTS reads character-by-character.

    Pipeline (order matters — MD link before bare URL strip so we don't
    leave empty ``[text]()`` after the URL got eaten):

      1. Markdown links ``[text](url)`` → keep ``text`` only
      2. Remaining bare URLs → drop entirely
      3. Parens-wrapped stock codes after Chinese → drop the parens
      4. Bare ticker with market suffix (.SH/.HK) → drop
      5. Parens-wrapped English (any length) after Chinese → drop
      6. Bare English 3-5 caps after Chinese → drop
      7. Dates ``Y/M/D`` / ``M/D`` (slash or dash) → 年月日 form

    Plain numbers (``2026 年``, ``25%``, bullet ``(1)``) survive.
    """
    s = _MD_LINK_RE.sub(r"\1", s)
    s = _URL_RE.sub("", s)
    s = _TICKER_IN_PARENS.sub(r"\1", s)
    s = _TICKER_WITH_SUFFIX.sub("", s)
    s = _ENGLISH_IN_PARENS.sub(r"\1", s)
    s = _ENGLISH_TICKER.sub(r"\1", s)
    # Date normalization — Y/M/D first (most specific) then M/D.
    s = _DATE_YMD.sub(r"\1年\2月\3日", s)
    s = _DATE_MD.sub(r"\1月\2日", s)
    return s


# URL pass strips ONLY when the URL is followed by whitespace or
# sentence punctuation — never by ``)`` or ``]`` (which would mean
# we're inside a markdown link's URL part that hasn't fully closed).
_URL_TERMINATOR = set(" \t\n。!?,;:、")


def strip_terminated_links_and_urls(buf: str) -> str:
    """Strip URLs / markdown links from ``buf`` that have been fully
    terminated (i.e. have at least one character after them, and that
    character is a natural-language terminator — not a closing paren
    which could indicate the construct is still being typed).

    Why this exists: the sentence splitter (``pop_speakable``) operates
    on the buffer character-by-character. Without this pass, a URL like
    ``https://tw.trip.com/blog/...`` lives in the buffer until the
    splitter cuts it at some chunk boundary (often mid-URL),
    fragmenting the URL across multiple TTS chunks. Stripping
    terminated URLs from the buffer before the splitter sees them
    means the splitter only ever sees natural-language content.
    """
    if not buf:
        return buf
    # 1. Markdown link — keep link text only when fully closed and
    # followed by at least one char (so we don't pre-strip while the
    # `(url)` is still typing).
    out: list[str] = []
    last = 0
    for m in _MD_LINK_RE.finditer(buf):
        if m.end() >= len(buf):
            break  # right at end — might still be growing
        out.append(buf[last: m.start()])
        out.append(m.group(1))  # link text
        last = m.end()
    out.append(buf[last:])
    buf = "".join(out)
    # 2. Bare URL — strip only when followed by whitespace OR sentence
    # punctuation. ``)`` does NOT count: it suggests we're inside an
    # in-flight markdown link whose closing `)` is also at buf end,
    # which would leave behind `[text]()`. Leave that case alone.
    out = []
    last = 0
    for m in _URL_RE.finditer(buf):
        end = m.end()
        if end >= len(buf):
            break  # URL at end — still growing
        if buf[end] not in _URL_TERMINATOR:
            continue   # URL "ends" at `)` etc — likely inside a wrapper
        out.append(buf[last: m.start()])
        last = end
    out.append(buf[last:])
    return "".join(out)
