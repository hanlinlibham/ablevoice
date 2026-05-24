"""Shared pytest fixtures.

Most live-loop tests need a running uvicorn instance. We expose a
session-scoped fixture that boots the server on a free port and tears
it down at session end — booting per-test would cost ~5s warmup
(model load) which is unacceptable for a test run.
"""

from __future__ import annotations

import os
import socket
import subprocess
import sys
import time
from pathlib import Path

import httpx
import pytest

ROOT = Path(__file__).resolve().parent.parent
ENV_LOCAL = ROOT / ".env.local"


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _load_env_local() -> dict[str, str]:
    """Parse .env.local for ABLEWORK / DASHSCOPE creds. Integration
    tests want real backends so they exercise the actual provider code,
    not a mock. Missing values are fine — the test will just skip the
    backends it can't reach."""
    env = {}
    if not ENV_LOCAL.exists():
        return env
    for line in ENV_LOCAL.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env


@pytest.fixture(scope="session")
def live_server():
    """Boot the real server on a free port. Yields the base URL
    (``http://127.0.0.1:PORT``). Killed at session end.

    Honours WARMUP from the environment (default WARMUP=1 → ~5s
    extra startup but first request is fast). Set WARMUP=0 in env
    when iterating locally if you don't mind slower first calls.
    """
    port = _free_port()
    env = {**os.environ, **_load_env_local()}
    env.setdefault("WARMUP", "1")
    # Don't pollute the dev DB — integration runs against the real one
    # by default since /history isn't asserted by these tests. If a
    # future test cares, point KEEP_AUDIO + DB at a tmpdir here.
    log_path = Path("/tmp/voice-test-server.log")
    log = log_path.open("w")
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "server:app",
         "--host", "127.0.0.1", "--port", str(port), "--log-level", "warning"],
        cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT,
    )
    base = f"http://127.0.0.1:{port}"
    try:
        # Wait for /health to come up (warmup runs in background, so this
        # responds quickly even when models are still loading).
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            try:
                if httpx.get(f"{base}/health", timeout=2).status_code == 200:
                    break
            except httpx.HTTPError:
                time.sleep(0.3)
        else:
            log.close()
            proc.kill()
            log_text = log_path.read_text(errors="replace")[-2000:]
            raise RuntimeError(f"server didn't come up in 30s\n{log_text}")
        # If WARMUP=1, also wait for warmup completion so tests don't
        # race against the first lazy load. WARMUP=0 → skip.
        if env.get("WARMUP", "1") not in ("0", "false", "no"):
            warm_deadline = time.monotonic() + 120
            while time.monotonic() < warm_deadline:
                text = log_path.read_text(errors="replace")
                if "warmup done" in text or "warmup failed" in text or "warmup skipped" in text:
                    break
                time.sleep(0.5)
        yield base
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
        log.close()
