"""API keys resource.

Port of ``typescript/packages/core/src/resources/api-keys.ts``.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from copass_core.resources.base import BaseResource


class ApiKeysResource(BaseResource):
    async def create(
        self,
        *,
        name: str,
        expires_in_days: Optional[int] = None,
    ) -> Dict[str, Any]:
        body: Dict[str, Any] = {"name": name}
        if expires_in_days is not None:
            body["expires_in_days"] = expires_in_days
        return await self._post("/api/v1/api-keys", body)

    async def list(self) -> List[Dict[str, Any]]:
        response = await self._get("/api/v1/api-keys")
        return response if isinstance(response, list) else []

    async def revoke(self, key_id: str) -> None:
        await self._delete(f"/api/v1/api-keys/{key_id}")


__all__ = ["ApiKeysResource"]
