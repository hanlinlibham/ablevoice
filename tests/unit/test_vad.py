"""Unit tests for voice.vad — pure endpoint logic + PCM re-blocking, plus
a model-gated smoke for the onnx wrapper.

``EndpointDetector`` and ``FrameChunker`` are model-free and run on every
``pytest`` invocation. ``SileroVad`` needs the silero onnx file; those
tests skip (don't fail) when it's absent so the offline suite stays green
on a fresh checkout. Add a case here whenever the endpoint state machine
or the tier-2 silence-budget rules change.
"""

from __future__ import annotations

import numpy as np
import pytest

from voice.config import settings
from voice.vad import (
    EndpointConfig,
    EndpointDetector,
    FrameChunker,
    SileroVad,
    VAD_FRAME_SAMPLES,
)


# --- endpoint state machine -------------------------------------------------

class TestEndpointOnset:
    """Onset requires sustained speech (debounce) so a lone noisy frame or
    a TTS-echo blip can't open a turn."""

    def test_onset_requires_full_onset_ms(self):
        det = EndpointDetector(EndpointConfig(threshold=0.5, frame_ms=32, onset_ms=128))
        # 3 frames = 96ms < 128ms — not yet.
        for _ in range(3):
            assert det.update(0.9) is None
        # 4th frame = 128ms >= onset_ms.
        assert det.update(0.9) == "onset"
        assert det.state == EndpointDetector.SPEAKING

    def test_silence_frame_resets_onset_run(self):
        det = EndpointDetector(EndpointConfig(frame_ms=32, onset_ms=128))
        for _ in range(3):
            det.update(0.9)            # 96ms accumulated
        assert det.update(0.0) is None  # gap breaks the run
        assert det.state == EndpointDetector.WAITING
        # need a fresh 4 consecutive frames now
        for _ in range(3):
            assert det.update(0.9) is None
        assert det.update(0.9) == "onset"

    def test_subthreshold_prob_is_not_speech(self):
        det = EndpointDetector(EndpointConfig(threshold=0.5, frame_ms=32, onset_ms=64))
        assert det.update(0.49) is None
        assert det.update(0.49) is None
        assert det.state == EndpointDetector.WAITING


class TestEndpointTier1:
    """Tier-1: fixed silence-timeout endpointing (no stable text)."""

    def test_endpoint_after_default_silence(self):
        det = EndpointDetector(EndpointConfig(frame_ms=32, onset_ms=128, silence_ms=900))
        for _ in range(4):
            det.update(0.9)            # onset
        # 900/32 -> 29 frames (28*32=896 < 900, 29*32=928 >= 900)
        for i in range(28):
            assert det.update(0.0) is None, f"endpoint fired too early at frame {i}"
        assert det.update(0.0) == "endpoint"

    def test_speech_frame_resets_silence(self):
        det = EndpointDetector(EndpointConfig(frame_ms=32, onset_ms=64, silence_ms=320))
        det.update(0.9); det.update(0.9)        # onset (64ms)
        for _ in range(5):
            det.update(0.0)                      # 160ms silence (< 320)
        det.update(0.9)                          # a speech frame resets it
        for _ in range(9):
            assert det.update(0.0) is None       # 288ms < 320
        assert det.update(0.0) == "endpoint"     # 320ms

    def test_endpoint_auto_resets_for_next_turn(self):
        det = EndpointDetector(EndpointConfig(frame_ms=32, onset_ms=64, silence_ms=320))
        det.update(0.9); det.update(0.9)
        for _ in range(9):
            det.update(0.0)
        assert det.update(0.0) == "endpoint"
        assert det.state == EndpointDetector.WAITING
        # a fresh turn can start immediately
        det.update(0.9)
        assert det.update(0.9) == "onset"


class TestEndpointTier2:
    """Tier-2: silence budget bends to the tail of the stable ASR partial."""

    def test_budget_terminal_punct_is_short(self):
        det = EndpointDetector(EndpointConfig(
            silence_ms=900, silence_ms_short=480, silence_ms_long=1500))
        assert det._silence_budget("你好。") == 480
        assert det._silence_budget("好的！") == 480
        assert det._silence_budget("是吗?") == 480

    def test_budget_filler_is_long(self):
        det = EndpointDetector(EndpointConfig(
            silence_ms=900, silence_ms_short=480, silence_ms_long=1500))
        assert det._silence_budget("帮我查一下然后") == 1500
        assert det._silence_budget("那个") == 1500
        assert det._silence_budget("我觉得就是") == 1500

    def test_budget_trailing_comma_is_long(self):
        det = EndpointDetector(EndpointConfig(silence_ms=900, silence_ms_long=1500))
        assert det._silence_budget("第一,") == 1500
        assert det._silence_budget("有这些、") == 1500

    def test_budget_plain_text_is_default(self):
        det = EndpointDetector(EndpointConfig(silence_ms=900))
        assert det._silence_budget("贵州茅台") == 900
        assert det._silence_budget("") == 900
        assert det._silence_budget("   ") == 900  # whitespace-only → default

    def test_terminal_punct_ends_sooner_than_filler(self):
        cfg = EndpointConfig(frame_ms=32, onset_ms=64,
                             silence_ms=900, silence_ms_short=480, silence_ms_long=1500)
        det = EndpointDetector(cfg)
        det.update(0.9); det.update(0.9)         # onset
        # terminal punct → 480/32 = 15 frames
        for _ in range(14):
            assert det.update(0.0, "你好。") is None
        assert det.update(0.0, "你好。") == "endpoint"

    def test_filler_waits_longer(self):
        cfg = EndpointConfig(frame_ms=32, onset_ms=64,
                             silence_ms=900, silence_ms_short=480, silence_ms_long=1500)
        det = EndpointDetector(cfg)
        det.update(0.9); det.update(0.9)         # onset
        # filler → 1500/32 = 47 frames; still listening at frame 46
        for _ in range(46):
            assert det.update(0.0, "帮我查然后") is None
        assert det.update(0.0, "帮我查然后") == "endpoint"


# --- PCM re-blocking --------------------------------------------------------

class TestFrameChunker:
    def test_reblocks_worklet_frames(self):
        fc = FrameChunker()
        frames = fc.push(np.zeros(800, dtype=np.int16).tobytes())
        n = 800 // VAD_FRAME_SAMPLES  # 800-sample worklet frame → N silero frames
        assert len(frames) == n
        assert all(f.shape[0] == VAD_FRAME_SAMPLES for f in frames)
        assert fc._buf.size == 800 - n * VAD_FRAME_SAMPLES  # remainder held over

    def test_no_sample_loss_across_pushes(self):
        fc = FrameChunker()
        total_in = total_out = 0
        for _ in range(20):
            pcm = np.random.randint(-2000, 2000, 800).astype(np.int16).tobytes()
            total_in += 800
            total_out += sum(f.shape[0] for f in fc.push(pcm))
        assert total_in == total_out + fc._buf.size

    def test_int16_scaled_into_unit_range(self):
        fc = FrameChunker()
        head = np.array([32767, -32768, 0], dtype=np.int16)
        pcm = np.concatenate([head, np.zeros(VAD_FRAME_SAMPLES - 3, dtype=np.int16)]).tobytes()
        frames = fc.push(pcm)
        assert len(frames) == 1
        assert frames[0].min() >= -1.0 and frames[0].max() <= 1.0

    def test_reset_clears_buffer(self):
        fc = FrameChunker()
        fc.push(np.zeros(800, dtype=np.int16).tobytes())
        assert fc._buf.size > 0
        fc.reset()
        assert fc._buf.size == 0


# --- Silero onnx wrapper (model-gated) --------------------------------------

@pytest.mark.skipif(
    not settings.vad.model_path.exists(),
    reason="silero_vad.onnx not present — run the download step",
)
class TestSileroVad:
    def test_silence_has_low_prob(self):
        vad = SileroVad(str(settings.vad.model_path))
        p = vad.prob(np.zeros(VAD_FRAME_SAMPLES, dtype=np.float32))
        assert 0.0 <= p <= 1.0
        assert p < 0.2  # pure silence must not read as speech

    def test_wrong_frame_size_raises(self):
        vad = SileroVad(str(settings.vad.model_path))
        with pytest.raises(ValueError):
            vad.prob(np.zeros(100, dtype=np.float32))

    def test_reset_zeros_state(self):
        vad = SileroVad(str(settings.vad.model_path))
        vad.prob(np.zeros(VAD_FRAME_SAMPLES, dtype=np.float32))
        vad.reset()
        assert float(np.abs(vad._state).sum()) == 0.0
