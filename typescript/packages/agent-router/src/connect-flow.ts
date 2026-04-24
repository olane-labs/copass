/**
 * Provider-OAuth flow helper — abstracts the "mint Connect URL, redirect
 * browser, poll for webhook-driven DataSource" dance into one call.
 *
 * Node-only: uses `node:http` for the short-lived success/error redirect
 * listener. Browsers should call `integrations.connect()` on `@copass/core`
 * directly and handle the redirect UX themselves (typically via a popup
 * + BroadcastChannel), so this module stays out of the browser bundle.
 */

import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type {
  ConnectionItem,
  CopassClient,
  IntegrationScope,
} from '@copass/core';

export interface ConnectFlowOptions {
  /** App slug (`slack_v2`, `github`, `notion`, …). Must be supported. */
  app: string;
  /** Default `'user'`. */
  scope?: IntegrationScope;
  /** Override project. */
  projectId?: string;
  /** Called with the hosted Connect URL — open a browser / print / webview. */
  onConnectUrl: (url: string) => void | Promise<void>;
  /** Max seconds waiting for the user to complete OAuth + webhook/reconcile. */
  timeoutSeconds?: number;
  /** Override success redirect (default: local listener). */
  successUri?: string;
  /** Override error redirect (default: local listener). */
  errorUri?: string;
  /** Called on each poll tick with the current reconcile result. */
  onPoll?: (info: { createdThisTick: number; elapsed: number }) => void;
}

export interface ConnectFlowResult {
  connection: ConnectionItem;
  sessionId: string;
}

/** Stand up a one-shot localhost HTTP listener on a random port. */
async function startRedirectListener(
  timeoutMs: number,
): Promise<{
  successUri: string;
  errorUri: string;
  waitForRedirect: () => Promise<'success' | 'error'>;
  close: () => void;
}> {
  let resolveRedirect!: (v: 'success' | 'error') => void;
  let rejectRedirect!: (e: Error) => void;
  const redirectPromise = new Promise<'success' | 'error'>((resolve, reject) => {
    resolveRedirect = resolve;
    rejectRedirect = reject;
  });

  const server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/oauth/success' || url.pathname === '/oauth/error') {
      const outcome = url.pathname === '/oauth/success' ? 'success' : 'error';
      const body =
        outcome === 'success'
          ? '<html><body style="font-family:sans-serif;padding:3rem"><h2>\u2713 Connection complete</h2><p>You can close this tab.</p></body></html>'
          : '<html><body style="font-family:sans-serif;padding:3rem"><h2>\u2717 Connection failed</h2><p>You can close this tab and retry.</p></body></html>';
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(body);
      resolveRedirect(outcome);
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;

  const timeout = setTimeout(() => {
    rejectRedirect(
      new Error(
        `Timed out after ${Math.round(timeoutMs / 1000)}s waiting for OAuth redirect.`,
      ),
    );
  }, timeoutMs);

  const close = () => {
    clearTimeout(timeout);
    try {
      server.close();
    } catch {
      /* ignore */
    }
  };

  return {
    successUri: `${base}/oauth/success`,
    errorUri: `${base}/oauth/error`,
    waitForRedirect: async () => {
      try {
        return await redirectPromise;
      } finally {
        close();
      }
    },
    close,
  };
}

/** Run the Copass integration connect flow end-to-end. Returns the new
 * connection once it lands, or throws on timeout / user denial. */
export async function runConnectFlow(
  client: CopassClient,
  sandboxId: string,
  options: ConnectFlowOptions,
): Promise<ConnectFlowResult> {
  const scope: IntegrationScope = options.scope ?? 'user';
  const app = options.app;
  const timeoutMs = Math.max(30, options.timeoutSeconds ?? 300) * 1000;

  // Snapshot existing connections so we can detect the new one.
  let knownBefore = new Set<string>();
  try {
    const existing = await client.integrations.list(sandboxId, { app });
    knownBefore = new Set(existing.items.map((c) => c.source_id));
  } catch {
    /* non-fatal — reconcile will still work */
  }

  const listener = await startRedirectListener(timeoutMs);
  const successUri = options.successUri ?? listener.successUri;
  const errorUri = options.errorUri ?? listener.errorUri;

  let sessionId = '';
  try {
    const resp = await client.integrations.connect(sandboxId, app, {
      scope,
      success_redirect_uri: successUri,
      error_redirect_uri: errorUri,
      project_id: options.projectId,
    });
    sessionId = resp.session_id;
    await options.onConnectUrl(resp.connect_url);
  } catch (err) {
    listener.close();
    throw err;
  }

  // Race the browser redirect against the reconcile poll — the webhook
  // can race us too, and that's fine; reconcile() is idempotent.
  const start = Date.now();
  const redirectPromise = listener.waitForRedirect().catch(() => 'timeout' as const);

  while (Date.now() - start < timeoutMs) {
    try {
      const r = await client.integrations.reconcile(sandboxId, { app, scope });
      for (const c of r.connections) {
        if (!knownBefore.has(c.source_id)) {
          listener.close();
          return { connection: c, sessionId };
        }
      }
      options.onPoll?.({ createdThisTick: r.created_count, elapsed: Date.now() - start });
    } catch {
      /* ignore transient errors */
    }

    // Yield briefly. If the redirect fires mid-sleep, we short-circuit
    // on the next loop iteration.
    const sleep = new Promise<'tick'>((r) => setTimeout(() => r('tick'), 2000));
    const winner = await Promise.race([
      redirectPromise.then((v) => (v === 'error' ? 'error' : 'redirect')),
      sleep,
    ]);
    if (winner === 'error') {
      listener.close();
      throw new Error('User denied the authorization or provider returned an error.');
    }
    // 'redirect' or 'tick' — either way, loop back and reconcile again.
  }

  listener.close();
  throw new Error(
    `Timed out after ${Math.round(timeoutMs / 1000)}s. The connection may still land — ` +
      'check `client.integrations.list()` in a moment or run reconcile manually.',
  );
}
