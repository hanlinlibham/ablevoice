"""Tests for voice.runtime helpers — focus on is_retryable_error()
because get-it-wrong-once = either retry storm on a 401 or no retry
on a 502 that would have worked."""

from __future__ import annotations

import asyncio

import httpx
import pytest

from voice.runtime import (
    RETRY_INITIAL_DELAY,
    is_retryable_error,
    with_retries,
)


class TestIsRetryable:

    @pytest.mark.parametrize("status_code", [500, 502, 503, 504, 429])
    def test_5xx_and_429_retryable(self, status_code):
        exc = RuntimeError(f"ablework HTTP {status_code}: upstream broke")
        assert is_retryable_error(exc) is True

    @pytest.mark.parametrize("status_code", [400, 401, 403, 404, 422])
    def test_4xx_not_retryable(self, status_code):
        exc = RuntimeError(f"ablework HTTP {status_code}: bad request")
        assert is_retryable_error(exc) is False

    def test_httpx_connect_error_retryable(self):
        assert is_retryable_error(httpx.ConnectError("conn refused")) is True

    def test_httpx_read_timeout_retryable(self):
        assert is_retryable_error(httpx.ReadTimeout("slow")) is True

    def test_asyncio_timeout_retryable(self):
        assert is_retryable_error(asyncio.TimeoutError()) is True

    def test_plain_runtime_error_not_retryable(self):
        # Programmer / API mismatch / "no chunks" etc — don't retry.
        assert is_retryable_error(RuntimeError("polish produced no audio")) is False

    def test_value_error_not_retryable(self):
        assert is_retryable_error(ValueError("bad arg")) is False

    def test_keyboard_interrupt_not_retryable(self):
        assert is_retryable_error(KeyboardInterrupt()) is False

    def test_cancelled_not_retryable(self):
        assert is_retryable_error(asyncio.CancelledError()) is False


class TestWithRetries:

    @pytest.mark.asyncio
    async def test_first_attempt_succeeds(self):
        calls = 0

        async def f():
            nonlocal calls
            calls += 1
            return "ok"

        assert await with_retries(f) == "ok"
        assert calls == 1

    @pytest.mark.asyncio
    async def test_retry_then_succeed(self, monkeypatch):
        # Make backoff sleep instant so the test runs fast.
        async def _no_sleep(_delay):
            return
        monkeypatch.setattr("voice.runtime.asyncio.sleep", _no_sleep)
        calls = 0

        async def f():
            nonlocal calls
            calls += 1
            if calls < 2:
                raise RuntimeError("ablework HTTP 502: nginx")
            return "ok"

        assert await with_retries(f) == "ok"
        assert calls == 2

    @pytest.mark.asyncio
    async def test_4xx_not_retried(self, monkeypatch):
        async def _no_sleep(_delay):
            return
        monkeypatch.setattr("voice.runtime.asyncio.sleep", _no_sleep)
        calls = 0

        async def f():
            nonlocal calls
            calls += 1
            raise RuntimeError("ablework HTTP 401: unauthorized")

        with pytest.raises(RuntimeError, match="401"):
            await with_retries(f)
        assert calls == 1

    @pytest.mark.asyncio
    async def test_exhausts_attempts(self, monkeypatch):
        async def _no_sleep(_delay):
            return
        monkeypatch.setattr("voice.runtime.asyncio.sleep", _no_sleep)
        calls = 0

        async def f():
            nonlocal calls
            calls += 1
            raise httpx.ConnectError("refused")

        with pytest.raises(httpx.ConnectError):
            await with_retries(f, attempts=3)
        assert calls == 3

    @pytest.mark.asyncio
    async def test_on_retry_callback_fires(self, monkeypatch):
        async def _no_sleep(_delay):
            return
        monkeypatch.setattr("voice.runtime.asyncio.sleep", _no_sleep)
        records = []

        def on_retry(attempt, exc, delay):
            records.append((attempt, type(exc).__name__, delay))

        async def f():
            if len(records) < 2:
                raise RuntimeError("ablework HTTP 503: gateway")
            return "ok"

        result = await with_retries(f, on_retry=on_retry)
        assert result == "ok"
        # Retried 2x (attempts 1 and 2 failed, 3 succeeded). 2 on_retry calls.
        assert len(records) == 2
        assert records[0][0] == 1
        assert records[1][0] == 2

    @pytest.mark.asyncio
    async def test_cancelled_propagates_not_retried(self, monkeypatch):
        async def _no_sleep(_delay):
            return
        monkeypatch.setattr("voice.runtime.asyncio.sleep", _no_sleep)
        calls = 0

        async def f():
            nonlocal calls
            calls += 1
            raise asyncio.CancelledError()

        with pytest.raises(asyncio.CancelledError):
            await with_retries(f)
        # Cancelled isn't retryable — bail on first attempt.
        assert calls == 1
