"""Users resource — user profile management.

Port of ``typescript/packages/core/src/resources/users.ts``.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from copass_core.resources.base import BaseResource


class UsersResource(BaseResource):
    async def create_profile(
        self,
        *,
        display_name: Optional[str] = None,
        canonical_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        body: Dict[str, Any] = {}
        if display_name is not None:
            body["display_name"] = display_name
        if canonical_id is not None:
            body["canonical_id"] = canonical_id
        return await self._post("/api/v1/users/me/profile", body)

    async def get_profile(self) -> Dict[str, Any]:
        return await self._get("/api/v1/users/me/profile")


__all__ = ["UsersResource"]
