"""Usage resource — token consumption and credit tracking.

Port of ``typescript/packages/core/src/resources/usage.ts``.
"""

from __future__ import annotations

from typing import Any, Dict

from copass_core.resources.base import BaseResource


class UsageResource(BaseResource):
    async def get_summary(self) -> Dict[str, Any]:
        return await self._get("/api/v1/usage")

    async def get_balance(self) -> Dict[str, Any]:
        return await self._get("/api/v1/usage/credits")


__all__ = ["UsageResource"]
