"""End-to-end OAuth connect flow helper.

Mirror of the TS ``runConnectFlow``. Uses Python's ``http.server`` for
the short-lived success/error redirect listener and polls
``integrations.reconcile`` until the DataSource lands.

Server-side / CLI flows use this; webapp flows typically skip the
listener and handle redirects in the browser directly.
"""

from __future__ import annotations

import asyncio
import http.server
import logging
import socket
import threading
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Optional, Union

from copass_core import CopassClient

logger = logging.getLogger(__name__)


OnConnectUrl = Callable[[str], Union[None, Awaitable[None]]]


@dataclass(frozen=True)
class ConnectFlowResult:
    connection: dict
    session_id: str


class _RedirectListener:
    """One-shot HTTP listener on ``127.0.0.1:<random>`` capturing
    ``/oauth/success`` or ``/oauth/error``."""

    def __init__(self) -> None:
        self._outcome: Optional[str] = None
        self._event = threading.Event()
        self._server: Optional[http.server.HTTPServer] = None
        self._thread: Optional[threading.Thread] = None

    def start(self) -> tuple[str, str]:
        outer = self

        class _Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self) -> None:  # noqa: N802
                path = (self.path or "/").split("?")[0]
                if path == "/oauth/success":
                    outer._outcome = "success"
                    body = (
                        "<html><body style='font-family:sans-serif;padding:3rem'>"
                        "<h2>\u2713 Connection complete</h2>"
                        "<p>You can close this tab.</p></body></html>"
                    )
                elif path == "/oauth/error":
                    outer._outcome = "error"
                    body = (
                        "<html><body style='font-family:sans-serif;padding:3rem'>"
                        "<h2>\u2717 Connection failed</h2>"
                        "<p>You can close this tab and retry.</p></body></html>"
                    )
                else:
                    self.send_response(404)
                    self.end_headers()
                    return
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.end_headers()
                self.wfile.write(body.encode("utf-8"))
                outer._event.set()

            def log_message(self, *_args: Any) -> None:  # silence stdlib stdout
                return

        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
        sock.close()
        self._server = http.server.HTTPServer(("127.0.0.1", port), _Handler)
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()
        base = f"http://127.0.0.1:{port}"
        return f"{base}/oauth/success", f"{base}/oauth/error"

    async def wait(self, timeout_seconds: float) -> Optional[str]:
        """Return 'success' | 'error' | None (timeout)."""
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, self._event.wait, timeout_seconds)
        return self._outcome

    def close(self) -> None:
        if self._server is not None:
            try:
                self._server.shutdown()
                self._server.server_close()
            except Exception:  # pragma: no cover
                pass


async def run_connect_flow(
    client: CopassClient,
    sandbox_id: str,
    *,
    app: str,
    on_connect_url: OnConnectUrl,
    scope: str = "user",
    project_id: Optional[str] = None,
    timeout_seconds: float = 300.0,
    success_uri: Optional[str] = None,
    error_uri: Optional[str] = None,
) -> ConnectFlowResult:
    """Run the Copass integrations connect flow end-to-end.

    1. Snapshots current connections for diff detection.
    2. Starts a localhost listener for the success redirect (unless
       caller supplied ``success_uri`` / ``error_uri``).
    3. Mints a Connect URL via :meth:`IntegrationsResource.connect`.
    4. Calls ``on_connect_url(url)`` — typically opens the browser.
    5. Polls ``integrations.reconcile`` every 2s until a new connection
       not in the pre-snapshot appears, OR the listener fires error, OR
       the timeout elapses.
    """
    # Snapshot
    try:
        existing = await client.integrations.list(sandbox_id, app=app)
        known_before = {c["source_id"] for c in existing.get("items", [])}
    except Exception:  # pragma: no cover — non-fatal
        known_before = set()

    listener: Optional[_RedirectListener] = None
    if success_uri is None or error_uri is None:
        listener = _RedirectListener()
        s, e = listener.start()
        success_uri = success_uri or s
        error_uri = error_uri or e

    try:
        resp = await client.integrations.connect(
            sandbox_id,
            app=app,
            scope=scope,
            success_redirect_uri=success_uri,
            error_redirect_uri=error_uri,
            project_id=project_id,
        )
        session_id = str(resp["session_id"])
        connect_url = str(resp["connect_url"])
        result = on_connect_url(connect_url)
        if asyncio.iscoroutine(result):
            await result

        # Poll reconcile until a new connection appears or the listener
        # signals 'error' or the timeout elapses.
        deadline = asyncio.get_event_loop().time() + timeout_seconds
        redirect_task: Optional[asyncio.Task[Optional[str]]] = (
            asyncio.create_task(listener.wait(timeout_seconds)) if listener else None
        )

        while asyncio.get_event_loop().time() < deadline:
            try:
                r = await client.integrations.reconcile(
                    sandbox_id, app=app, scope=scope
                )
                for c in r.get("connections", []):
                    if c["source_id"] not in known_before:
                        if redirect_task is not None:
                            redirect_task.cancel()
                        return ConnectFlowResult(
                            connection=dict(c), session_id=session_id
                        )
            except Exception:
                pass

            if redirect_task is not None and redirect_task.done():
                outcome = redirect_task.result()
                if outcome == "error":
                    raise RuntimeError(
                        "User denied the authorization or provider returned an error."
                    )

            await asyncio.sleep(2.0)

        raise TimeoutError(
            f"Timed out after {int(timeout_seconds)}s — the connection may still "
            "land. Check `client.integrations.list(sandbox_id)` or run reconcile."
        )
    finally:
        if listener is not None:
            listener.close()


__all__ = ["run_connect_flow", "ConnectFlowResult", "OnConnectUrl"]
