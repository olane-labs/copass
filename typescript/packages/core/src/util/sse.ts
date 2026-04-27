/**
 * Generic Server-Sent Events parser for the Copass SDK.
 *
 * Consumes a `Response` whose body is an SSE stream
 * (`text/event-stream`, `event: <name>\ndata: <json>\n\n`) and yields
 * one `{event, data}` object per complete frame. Used by the
 * Concierge `chat()` and the Reactive Agents `streamRun()` resources.
 *
 * Wire format: matches `sse_starlette.EventSourceResponse` exactly
 * (Python server side at `frame_graph/copass_id/api/concierge.py` +
 * `frame_graph/copass_id/api/agents.py`):
 *
 *   event: <name>\n
 *   data: <one-line JSON>\n
 *   \n          ← blank line terminates the frame
 *
 * `: comment` lines (used by `sse_starlette` for the keepalive ping)
 * are silently dropped. Multi-line `data:` continuations are joined
 * with a literal `\n`. Frames missing a `data:` line are dropped.
 *
 * Cancellation: caller invokes `response.body?.cancel()` (or breaks
 * the `for await`) — the parser releases its reader and returns. The
 * underlying fetch task is cancelled by the runtime.
 *
 * Reconnection: NOT handled here. Copass SSE streams are one-shot
 * (one chat turn = one request); reconnect with a new POST carrying
 * the prior `session_id` to continue a conversation.
 */

export interface SSEEvent {
  /** Event name from the `event:` line (e.g. `agent_text_delta`). */
  event: string;
  /**
   * Parsed JSON payload from the `data:` line(s). When the data isn't
   * valid JSON, falls back to the raw string. Most Copass SSE frames
   * carry a JSON object; non-JSON would be a server bug.
   */
  data: unknown;
}

/**
 * Async-iterate decoded SSE frames from a `Response`.
 *
 * @example
 * ```typescript
 * const response = await fetch(url, { method: 'POST', body, headers });
 * for await (const frame of parseSSE(response)) {
 *   if (frame.event === 'agent_text_delta') {
 *     process.stdout.write((frame.data as { text: string }).text);
 *   }
 * }
 * ```
 */
export async function* parseSSE(response: Response): AsyncIterable<SSEEvent> {
  if (!response.body) {
    throw new Error('parseSSE: Response has no body — server returned an empty stream');
  }
  if (!response.ok) {
    // Surface non-2xx clearly. Body has already been initiated; consume
    // it as text for the error message rather than yielding partials.
    const text = await response.text().catch(() => '');
    throw new Error(`parseSSE: SSE request failed (${response.status}): ${text || response.statusText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (value) {
        buffer += decoder.decode(value, { stream: true });
      }
      // Each frame ends with a blank line (\n\n). Standard SSE also
      // accepts \r\n\r\n; normalize before splitting.
      const normalized = buffer.replace(/\r\n/g, '\n');
      const frames = normalized.split('\n\n');
      // Last item may be a partial frame — keep it in the buffer.
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        const parsed = parseFrame(frame);
        if (parsed) yield parsed;
      }
      if (done) {
        // Flush whatever's still in the buffer (server may have sent
        // a final frame without the trailing blank line).
        const tail = parseFrame(buffer + decoder.decode());
        if (tail) yield tail;
        return;
      }
    }
  } finally {
    // Cancel the underlying stream so that breaking out of the
    // for-await loop closes the connection. Without this, the SSE
    // socket stays open until GC, the server doesn't see a
    // disconnect, and any long-running work (e.g. an LLM stream)
    // keeps consuming resources. Cancellation propagates to the
    // server as `asyncio.CancelledError` on FastAPI's side.
    try {
      await reader.cancel();
    } catch {
      // Already closed / cancelled — ignore.
    }
    try {
      reader.releaseLock();
    } catch {
      // Already released — ignore.
    }
  }
}

/**
 * Parse one frame's lines into an `SSEEvent`. Returns `null` for
 * frames with no `data:` line (e.g. keepalive comments) so the
 * caller can skip them with a single null check.
 */
function parseFrame(raw: string): SSEEvent | null {
  if (!raw.trim()) return null;
  let event = 'message';   // SSE default per the spec when no `event:` line is set
  const dataLines: string[] = [];
  for (const line of raw.split('\n')) {
    if (!line || line.startsWith(':')) continue;   // comment / keepalive
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const field = line.slice(0, idx);
    // Per SSE spec, a single space after the colon is consumed
    const value = line.slice(idx + 1).startsWith(' ')
      ? line.slice(idx + 2)
      : line.slice(idx + 1);
    if (field === 'event') event = value;
    else if (field === 'data') dataLines.push(value);
    // `id:` and `retry:` are spec'd but Copass doesn't use them.
  }
  if (dataLines.length === 0) return null;
  const dataStr = dataLines.join('\n');
  let data: unknown = dataStr;
  try {
    data = JSON.parse(dataStr);
  } catch {
    // Non-JSON data — keep the raw string. Server bug if this
    // happens for a known event type, but worth surfacing rather
    // than swallowing.
  }
  return { event, data };
}
