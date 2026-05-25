"""Ablework REST client — workspace / auth surface used by the intent
handlers.

This is separate from ``voice/providers/llm.py`` (which handles the
streaming chat path) because the workspace endpoints are plain JSON
REST, used by intent handlers ("切到 X 工作区") and the WS hello
bootstrap (fetch list of workspaces for the LLM classifier context).

All calls wrapped in ``with_retries`` so a single 502 from ablework's
nginx doesn't break workspace switching.
"""

from __future__ import annotations

import logging
from typing import Any, Optional

import httpx

from .config import settings
from .runtime import with_retries

logger = logging.getLogger("voice.ablework_api")


def _headers() -> dict[str, str]:
    if not settings.ablework.token:
        raise RuntimeError("ABLEWORK_TOKEN not set")
    return {
        "Authorization": f"Bearer {settings.ablework.token}",
        "Content-Type": "application/json",
    }


def _api_base() -> str:
    """Derive base URL from ABLEWORK_URL (which points at /api/chat).
    Strip the ``/chat`` suffix to get the API root."""
    chat_url = settings.ablework.url
    if chat_url.endswith("/chat"):
        return chat_url[: -len("/chat")]
    if chat_url.endswith("/chat/"):
        return chat_url[: -len("/chat/")]
    return chat_url  # already a base


async def list_workspaces() -> list[dict[str, Any]]:
    """``GET /workspaces`` — returns ``workspaces`` array sorted by
    ``last_active_at`` desc. Each item has id / name / owner_user_id /
    primary_folder_id / description / config / sort_order / created_at /
    last_active_at / updated_at."""
    async def _call() -> list[dict[str, Any]]:
        async with httpx.AsyncClient(
            timeout=10.0, verify=settings.ablework.verify_ssl,
        ) as client:
            r = await client.get(f"{_api_base()}/workspaces", headers=_headers())
            if r.status_code != 200:
                raise RuntimeError(f"ablework HTTP {r.status_code}: {r.text[:200]}")
            data = r.json()
        # Endpoint returns {"workspaces": [...], "total": N}.
        return list(data.get("workspaces") or [])

    return await with_retries(_call)


async def get_workspace(workspace_id: str) -> dict[str, Any]:
    """``GET /workspaces/{id}`` — single workspace detail."""
    async def _call() -> dict[str, Any]:
        async with httpx.AsyncClient(
            timeout=10.0, verify=settings.ablework.verify_ssl,
        ) as client:
            r = await client.get(
                f"{_api_base()}/workspaces/{workspace_id}", headers=_headers(),
            )
            if r.status_code != 200:
                raise RuntimeError(f"ablework HTTP {r.status_code}: {r.text[:200]}")
            return r.json()

    return await with_retries(_call)


async def touch_workspace(workspace_id: str) -> None:
    """``POST /workspaces/{id}/touch`` — mark recent (affects list order)."""
    async def _call() -> None:
        async with httpx.AsyncClient(
            timeout=10.0, verify=settings.ablework.verify_ssl,
        ) as client:
            r = await client.post(
                f"{_api_base()}/workspaces/{workspace_id}/touch", headers=_headers(),
            )
            if r.status_code not in (200, 204):
                raise RuntimeError(f"ablework HTTP {r.status_code}: {r.text[:200]}")

    await with_retries(_call)


async def create_workspace(
    name: str, *, description: str = "",
) -> dict[str, Any]:
    """``POST /workspaces`` with ``CreateWorkspaceReq`` body. Returns
    the new workspace row."""
    async def _call() -> dict[str, Any]:
        body = {"name": name, "description": description}
        async with httpx.AsyncClient(
            timeout=15.0, verify=settings.ablework.verify_ssl,
        ) as client:
            r = await client.post(
                f"{_api_base()}/workspaces", headers=_headers(), json=body,
            )
            if r.status_code not in (200, 201):
                raise RuntimeError(f"ablework HTTP {r.status_code}: {r.text[:200]}")
            return r.json()

    return await with_retries(_call)


async def get_me() -> Optional[dict[str, Any]]:
    """``GET /auth/me`` — return current identity. Returns None on auth
    failure rather than raising so callers can show a graceful warn."""
    try:
        async with httpx.AsyncClient(
            timeout=5.0, verify=settings.ablework.verify_ssl,
        ) as client:
            r = await client.get(f"{_api_base()}/auth/me", headers=_headers())
            if r.status_code != 200:
                logger.warning("/auth/me HTTP %d: %s", r.status_code, r.text[:200])
                return None
            return r.json()
    except Exception:
        logger.exception("/auth/me crashed")
        return None
