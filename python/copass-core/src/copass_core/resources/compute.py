"""Compute Router v1 — public compute SDK surface (ADR 0020 + ADR 0026).

Hits the seven ``/api/v1/storage/sandboxes/{sandbox_id}/compute/*``
endpoints. Auth is the same API key / bearer the developer uses for
``/agents``, ``/sources``, ``/sandboxes`` — no new flow.

ADR 0026 Phase 3 also lands the runtime ``ComputeSession`` wrapper:
``createSession`` / ``getSession`` / ``listSessions`` return instances
of :class:`ComputeSession` which expose the gateway helpers
(``proxy_url`` / ``websocket_url`` / ``fetch``) for talking directly to
the per-port reverse proxy.

All session ids on this surface are platform-issued opaque UUIDs; the
provider's ``external_session_id`` is server-internal and intentionally
NOT returned (per ADR 0020 §"Public surface — server-side").

Port of ``typescript/packages/core/src/resources/compute.ts`` and
``typescript/packages/core/src/resources/compute-session.ts``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Literal, Optional

import httpx

from copass_core.http.http_client import HttpClient
from copass_core.resources.base import BaseResource


_STORAGE_BASE = "/api/v1/storage/sandboxes"


def _compute_base(sandbox_id: str) -> str:
    return f"{_STORAGE_BASE}/{sandbox_id}/compute"


# ── Type aliases ────────────────────────────────────────────────────

# TS uses an open union (`'daytona' | 'e2b' | (string & {})`); Python
# mirrors that with a plain ``str`` so the server adding a third
# provider doesn't force a client-side type bump.
ComputeProvider = str
"""Underlying compute provider. Conventional values: ``"daytona"`` /
``"e2b"``. Open union — adding a provider on the server does NOT
break SDK consumers."""

ComputeSessionStatus = str
"""Status returned on ``ComputeSessionResponse.status``. Conventional
values: ``"provisioning"``, ``"running"``, ``"idle"``, ``"stopped"``,
``"archived"``, ``"failed"``. Open union for forward-compat."""

ComputeSessionHealthStatus = str
"""Liveness-derived status from ``GET /sessions/{session_id}/health``.
Conventional values: ``"ready"``, ``"starting"``, ``"stopped"``,
``"errored"``. Open union."""


# ── Wire dataclasses ────────────────────────────────────────────────


@dataclass(frozen=True)
class ComputeTemplate:
    """One curated compute template available for provisioning."""

    name: str
    provider: ComputeProvider
    cpu_count: int
    memory_mb: int
    description: str

    @classmethod
    def from_dict(cls, payload: Dict[str, Any]) -> "ComputeTemplate":
        return cls(
            name=str(payload.get("name", "")),
            provider=str(payload.get("provider", "")),
            cpu_count=int(payload.get("cpu_count", 0)),
            memory_mb=int(payload.get("memory_mb", 0)),
            description=str(payload.get("description", "")),
        )


@dataclass(frozen=True)
class ListComputeTemplatesResponse:
    templates: List[ComputeTemplate] = field(default_factory=list)


@dataclass(frozen=True)
class ComputeGateway:
    """Per-session reverse-proxy gateway envelope (ADR 0026).

    Server emits this on every session response when the deployment
    has the compute gateway feature enabled. The SDK formats per-port
    URLs locally by substituting ``{base_url}``, ``{session_id}``,
    ``{port}``, and ``{path}`` into ``url_template`` — never by string
    concatenation.

    Absent on deployments without the gateway feature; callers that
    try to construct a proxy URL on such a deployment get a thrown
    :class:`ValueError`.
    """

    base_url: str
    url_template: str
    kind: Literal["edge-proxy-v1"] = "edge-proxy-v1"


@dataclass(frozen=True)
class ComputeSessionResponse:
    """One compute session as projected onto the wire.

    The provider's ``external_session_id`` is server-internal and does
    NOT appear here (per ADR 0020 §"Public surface — server-side").
    """

    session_id: str
    template: str
    status: ComputeSessionStatus
    provisioned_at: str
    deadline_at: str
    last_activity_at: str
    metadata: Dict[str, str] = field(default_factory=dict)
    gateway: Optional[ComputeGateway] = None

    @classmethod
    def from_dict(cls, payload: Dict[str, Any]) -> "ComputeSessionResponse":
        gateway_payload = payload.get("gateway")
        gateway: Optional[ComputeGateway] = None
        if gateway_payload is not None:
            gateway = ComputeGateway(
                base_url=str(gateway_payload.get("base_url", "")),
                url_template=str(gateway_payload.get("url_template", "")),
                kind=gateway_payload.get("kind", "edge-proxy-v1"),
            )
        return cls(
            session_id=str(payload.get("session_id", "")),
            template=str(payload.get("template", "")),
            status=str(payload.get("status", "")),
            provisioned_at=str(payload.get("provisioned_at", "")),
            deadline_at=str(payload.get("deadline_at", "")),
            last_activity_at=str(payload.get("last_activity_at", "")),
            metadata=dict(payload.get("metadata") or {}),
            gateway=gateway,
        )


@dataclass(frozen=True)
class ComputeExecResponse:
    """Result of one ``/exec`` call.

    A non-zero ``exit_code`` is the user's command failing — the call
    still returns 200; only provider / billing failures return non-2xx.
    """

    stdout: str
    stderr: str
    exit_code: int
    elapsed_ms: int
    truncated: bool

    @classmethod
    def from_dict(cls, payload: Dict[str, Any]) -> "ComputeExecResponse":
        return cls(
            stdout=str(payload.get("stdout", "")),
            stderr=str(payload.get("stderr", "")),
            exit_code=int(payload.get("exit_code", 0)),
            elapsed_ms=int(payload.get("elapsed_ms", 0)),
            truncated=bool(payload.get("truncated", False)),
        )


@dataclass(frozen=True)
class ComputeSessionHealthResponse:
    session_id: str
    status: ComputeSessionHealthStatus
    last_activity_at: str

    @classmethod
    def from_dict(cls, payload: Dict[str, Any]) -> "ComputeSessionHealthResponse":
        return cls(
            session_id=str(payload.get("session_id", "")),
            status=str(payload.get("status", "")),
            last_activity_at=str(payload.get("last_activity_at", "")),
        )


@dataclass(frozen=True)
class StopComputeSessionResponse:
    session_id: str
    status: str

    @classmethod
    def from_dict(cls, payload: Dict[str, Any]) -> "StopComputeSessionResponse":
        return cls(
            session_id=str(payload.get("session_id", "")),
            status=str(payload.get("status", "")),
        )


# ── Runtime wrapper ─────────────────────────────────────────────────

GATEWAY_NOT_CONFIGURED = (
    "Gateway is not configured on this Copass deployment. "
    "The compute session response did not include a `gateway` envelope "
    "(ADR 0026 Phase 1 must be deployed server-side and the "
    "COMPUTE_GATEWAY_BASE_URL env var must be set)."
)


class ComputeSession:
    """Runtime wrapper around a :class:`ComputeSessionResponse` (ADR 0026).

    Returned by :meth:`ComputeResource.create_session`,
    :meth:`ComputeResource.get_session`, and (for each element)
    :meth:`ComputeResource.list_sessions`. Every field of the
    underlying wire record is preserved (field-copied) and three
    gateway helpers are bolted on:

    - :meth:`proxy_url` — ``https://...`` URL for the per-port reverse
      proxy.
    - :meth:`websocket_url` — same URL with the scheme rewritten to
      ``wss://``.
    - :meth:`fetch` — passthrough ``httpx.AsyncClient`` request with
      bearer auth.

    URL construction is template substitution against
    ``record.gateway.url_template`` — NOT string concatenation. Path
    is the caller's responsibility (ADR 0026 §"The `gateway` Envelope
    (locked)"): pass ``""`` for the bare per-port URL, or a string
    starting with ``/``.

    :meth:`fetch` deliberately bypasses :meth:`HttpClient.request` —
    see the comment at the call site for why. The auth source is
    shared, the transport isn't.
    """

    # Public, read-only field-copies of the underlying wire record.
    session_id: str
    template: str
    status: ComputeSessionStatus
    provisioned_at: str
    deadline_at: str
    last_activity_at: str
    metadata: Dict[str, str]
    gateway: Optional[ComputeGateway]
    record: ComputeSessionResponse

    def __init__(self, http: HttpClient, record: ComputeSessionResponse) -> None:
        self._http = http
        self.record = record
        self.session_id = record.session_id
        self.template = record.template
        self.status = record.status
        self.provisioned_at = record.provisioned_at
        self.deadline_at = record.deadline_at
        self.last_activity_at = record.last_activity_at
        self.metadata = record.metadata
        self.gateway = record.gateway

    def proxy_url(self, port: int, path: str = "") -> str:
        """Build the ``https://`` (or ``http://``) reverse-proxy URL
        for ``port`` on this session.

        ``path`` defaults to ``""`` — ``proxy_url(3000, "")`` yields
        the bare per-port URL with no trailing slash. Pass
        ``"/api/v1/x"`` (leading slash) for a sub-path. Path is the
        caller's responsibility per ADR 0026 §"The `gateway` Envelope
        (locked)".
        """
        gw = self._require_gateway()
        return (
            gw.url_template
            .replace("{base_url}", gw.base_url)
            .replace("{session_id}", self.session_id)
            .replace("{port}", str(port))
            .replace("{path}", path)
        )

    def websocket_url(self, port: int, path: str = "") -> str:
        """:meth:`proxy_url` with the URL scheme rewritten —
        ``https://`` → ``wss://``, ``http://`` → ``ws://``. Pure
        prefix swap; everything after the scheme is identical to
        ``proxy_url(port, path)``.
        """
        url = self.proxy_url(port, path)
        if url.startswith("https://"):
            return "wss://" + url[len("https://"):]
        if url.startswith("http://"):
            return "ws://" + url[len("http://"):]
        return url

    async def fetch(self, port: int, path: str, **kwargs: Any) -> httpx.Response:
        """Issue a request against ``port`` on this session via the
        gateway.

        Thin passthrough to ``httpx.AsyncClient.request``: the only
        thing the SDK adds is the gateway-resolved URL and the
        ``Authorization: Bearer <token>`` header (token pulled fresh
        per call from the same auth provider the rest of
        ``copass_core`` uses). Body / headers / method / timeout / etc.
        flow through ``**kwargs`` untouched.

        No JSON serialization, no JSON parsing, no retries, no error
        normalization — those would break legitimate sandbox traffic
        (binary uploads, SSE, intentional non-2xx bodies the caller
        wants to inspect). See ADR 0026 §"Python SDK".
        """
        url = self.proxy_url(port, path)
        session = await self._http.get_auth_session()

        # Merge caller-supplied headers with the bearer header. Caller
        # headers go in first; the bearer always wins on the
        # ``Authorization`` key because every gateway request needs it.
        method = kwargs.pop("method", "GET")
        caller_headers = kwargs.pop("headers", None) or {}
        headers = {**caller_headers, "Authorization": f"Bearer {session.access_token}"}

        # Bypassing HttpClient.request on purpose — the gateway is a
        # transparent passthrough. ADR 0026 §"Python SDK".
        async with httpx.AsyncClient() as client:
            return await client.request(method, url, headers=headers, **kwargs)

    def _require_gateway(self) -> ComputeGateway:
        if self.gateway is None:
            raise ValueError(GATEWAY_NOT_CONFIGURED)
        return self.gateway


# ── Wrapped list response (depends on ComputeSession) ───────────────


@dataclass(frozen=True)
class ListComputeSessionsResponse:
    """Envelope returned by :meth:`ComputeResource.list_sessions`.

    Each element is a :class:`ComputeSession` (already wrapped) so the
    caller can immediately call ``proxy_url`` / ``fetch`` on any
    session in the list without re-fetching it.
    """

    sessions: List[ComputeSession] = field(default_factory=list)


# ── Resource ────────────────────────────────────────────────────────


class ComputeResource(BaseResource):
    """Compute Router v1 resource (ADR 0020 + ADR 0026).

    Example::

        templates = await client.compute.list_templates(sandbox_id)
        session = await client.compute.create_session(
            sandbox_id, template=templates.templates[0].name,
            timeout_seconds=600,
        )
        result = await client.compute.exec(
            sandbox_id, session.session_id,
            cmd=["python", "-c", "print('hi')"],
        )
        await client.compute.stop_session(sandbox_id, session.session_id)
    """

    async def list_templates(
        self,
        sandbox_id: str,
        *,
        provider: Optional[ComputeProvider] = None,
    ) -> ListComputeTemplatesResponse:
        """List curated compute templates available for this sandbox."""
        payload = await self._get(
            f"{_compute_base(sandbox_id)}/templates",
            query={"provider": provider},
        )
        return ListComputeTemplatesResponse(
            templates=[
                ComputeTemplate.from_dict(t) for t in (payload.get("templates") or [])
            ],
        )

    async def create_session(
        self,
        sandbox_id: str,
        *,
        template: str,
        env_vars: Optional[Dict[str, str]] = None,
        timeout_seconds: Optional[int] = None,
        metadata: Optional[Dict[str, str]] = None,
    ) -> ComputeSession:
        """Provision a new compute session.

        Returns a :class:`ComputeSession` wrapping the platform-issued
        ``session_id`` — pass it to subsequent ``/exec`` / ``/health``
        / ``stop_session`` calls, or use the gateway helpers
        (``proxy_url`` / ``websocket_url`` / ``fetch``) on it directly.

        Raises on:
          - 402 — insufficient credits
          - 403 — kill-switch engaged
          - 404 — unknown template
          - 409 — per-user concurrency cap exceeded
          - 502 — vendor SDK error
        """
        body: Dict[str, Any] = {"template": template}
        if env_vars is not None:
            body["env_vars"] = dict(env_vars)
        if timeout_seconds is not None:
            body["timeout_seconds"] = timeout_seconds
        if metadata is not None:
            body["metadata"] = dict(metadata)
        payload = await self._post(f"{_compute_base(sandbox_id)}/sessions", body)
        record = ComputeSessionResponse.from_dict(payload)
        return ComputeSession(self._http, record)

    async def list_sessions(
        self,
        sandbox_id: str,
        *,
        include_stopped: Optional[bool] = None,
        limit: Optional[int] = None,
    ) -> ListComputeSessionsResponse:
        """List compute sessions for this (user, sandbox).

        Defaults to active sessions; pass ``include_stopped=True`` to
        also see terminal-state rows.
        """
        query: Dict[str, Optional[str]] = {}
        if include_stopped:
            query["include_stopped"] = "true"
        if limit is not None:
            query["limit"] = str(limit)
        payload = await self._get(
            f"{_compute_base(sandbox_id)}/sessions",
            query=query or None,
        )
        sessions: List[ComputeSession] = []
        for raw in (payload.get("sessions") or []):
            record = ComputeSessionResponse.from_dict(raw)
            sessions.append(ComputeSession(self._http, record))
        return ListComputeSessionsResponse(sessions=sessions)

    async def get_session(
        self,
        sandbox_id: str,
        session_id: str,
    ) -> ComputeSession:
        """Fetch one compute session by its platform ``session_id``."""
        payload = await self._get(
            f"{_compute_base(sandbox_id)}/sessions/{session_id}",
        )
        record = ComputeSessionResponse.from_dict(payload)
        return ComputeSession(self._http, record)

    async def stop_session(
        self,
        sandbox_id: str,
        session_id: str,
    ) -> StopComputeSessionResponse:
        """Stop a compute session and bill the elapsed compute time.

        Idempotent — a session already in a terminal state returns
        ``status='stopped'`` without re-calling the provider or
        re-billing.
        """
        payload = await self._delete(
            f"{_compute_base(sandbox_id)}/sessions/{session_id}",
        )
        return StopComputeSessionResponse.from_dict(payload or {})

    async def exec(
        self,
        sandbox_id: str,
        session_id: str,
        *,
        cmd: List[str],
        stdin: Optional[str] = None,
        timeout_seconds: Optional[int] = None,
    ) -> ComputeExecResponse:
        """Run a single-shot command inside a provisioned sandbox.

        A non-zero ``exit_code`` on the returned shape is the user's
        command failing — the call still returns 200 (no raise).
        Provider / billing failures raise via the standard
        :class:`CopassApiError` path.
        """
        body: Dict[str, Any] = {"cmd": list(cmd)}
        if stdin is not None:
            body["stdin"] = stdin
        if timeout_seconds is not None:
            body["timeout_seconds"] = timeout_seconds
        payload = await self._post(
            f"{_compute_base(sandbox_id)}/sessions/{session_id}/exec",
            body,
        )
        return ComputeExecResponse.from_dict(payload)

    async def session_health(
        self,
        sandbox_id: str,
        session_id: str,
    ) -> ComputeSessionHealthResponse:
        """Best-effort liveness check on a compute session.

        Sessions in terminal row states short-circuit without a
        provider round-trip.
        """
        payload = await self._get(
            f"{_compute_base(sandbox_id)}/sessions/{session_id}/health",
        )
        return ComputeSessionHealthResponse.from_dict(payload)


__all__ = [
    "ComputeProvider",
    "ComputeSessionStatus",
    "ComputeSessionHealthStatus",
    "ComputeTemplate",
    "ListComputeTemplatesResponse",
    "ComputeGateway",
    "ComputeSessionResponse",
    "ListComputeSessionsResponse",
    "ComputeExecResponse",
    "ComputeSessionHealthResponse",
    "StopComputeSessionResponse",
    "ComputeSession",
    "ComputeResource",
    "GATEWAY_NOT_CONFIGURED",
]
