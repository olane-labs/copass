"""Vault resource — encrypted object storage scoped to a sandbox.

Port of ``typescript/packages/core/src/resources/vault.ts`` plus
``types/vault.ts``. v0.2 ships the wire-level wrappers;
client-side encryption (``encrypt=True``) requires the crypto module
(v0.3) — today it just sets the ``encrypt=true`` query flag and lets
the server handle it.
"""

from __future__ import annotations

from typing import Any, Dict, Optional
from urllib.parse import quote

from copass_core.http.http_client import RequestOptions
from copass_core.resources.base import BaseResource


def _base(sandbox_id: str) -> str:
    return f"/api/v1/storage/sandboxes/{sandbox_id}/vault"


def _encode_key(key: str) -> str:
    """Preserve ``/`` as path separator; percent-encode everything
    else. Server matches against ``{key:path}``."""
    return "/".join(quote(segment, safe="") for segment in key.split("/"))


class VaultResource(BaseResource):
    """``/api/v1/storage/sandboxes/{id}/vault``.

    Store raw bytes under an arbitrary key path. Supports optional
    server-side encryption and content-hash deduplication.
    """

    async def store(
        self,
        sandbox_id: str,
        key: str,
        data: bytes,
        *,
        encrypt: bool = False,
        deduplicate: bool = False,
        content_type: str = "application/octet-stream",
    ) -> Dict[str, Any]:
        """PUT raw bytes at ``key``. Returns the vault response
        (stored key, size, dedup flags, etc.)."""
        return await self._http.request(
            f"{_base(sandbox_id)}/{_encode_key(key)}",
            RequestOptions(
                method="PUT",
                raw_body=data,
                headers={"Content-Type": content_type},
                query={
                    "encrypt": "true" if encrypt else None,
                    "deduplicate": "true" if deduplicate else None,
                },
            ),
        )

    async def retrieve(
        self,
        sandbox_id: str,
        key: str,
        *,
        decrypt: bool = True,
    ) -> bytes:
        """GET the raw bytes at ``key``. Server decrypts by default;
        pass ``decrypt=False`` to receive ciphertext."""
        result = await self._http.request(
            f"{_base(sandbox_id)}/{_encode_key(key)}",
            RequestOptions(
                method="GET",
                raw_response=True,
                query={"decrypt": None if decrypt else "false"},
            ),
        )
        return result if isinstance(result, (bytes, bytearray)) else bytes(result or b"")

    async def delete(self, sandbox_id: str, key: str) -> Dict[str, Any]:
        return await self._delete(f"{_base(sandbox_id)}/{_encode_key(key)}")

    async def list(
        self,
        sandbox_id: str,
        *,
        prefix: Optional[str] = None,
        max_keys: Optional[int] = None,
    ) -> Dict[str, Any]:
        return await self._get(
            _base(sandbox_id),
            query={
                "prefix": prefix,
                "max_keys": str(max_keys) if max_keys is not None else None,
            },
        )


__all__ = ["VaultResource"]
