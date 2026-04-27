import { BaseResource } from './base.js';
import { parseSSE, type SSEEvent } from '../util/sse.js';
import type {
  ConciergeChatRequest,
  ConciergeEvent,
  ConciergeTestRequest,
  ConciergeTestResponse,
} from '../types/concierge.js';

const BASE = '/api/v1/storage/sandboxes';

function conciergeBase(sandboxId: string): string {
  return `${BASE}/${sandboxId}/concierge`;
}

/**
 * Copass Concierge — per-user platform agent for managing your
 * Copass setup conversationally.
 *
 * Two endpoints:
 *
 *   * `test()` — synchronous one-shot. Returns the agent's full
 *     reply + run summary. Use for quick smoke checks; production
 *     UX should use `chat()` for token-streaming.
 *
 *   * `chat()` — multi-turn streaming. Returns an
 *     `AsyncIterable<ConciergeEvent>` that yields `run_started`
 *     once, then `agent_text_delta` / `agent_tool_call` /
 *     `agent_tool_result` / `agent_finish` (or `agent_error`).
 *     Pass the `session_id` from the prior turn's `agent_finish`
 *     event to continue the same conversation.
 *
 * @example
 * ```typescript
 * // Synchronous
 * const summary = await client.concierge.test(sandboxId, {
 *   message: 'list my sources',
 * });
 *
 * // Streaming
 * let sessionId: string | undefined;
 * for await (const evt of client.concierge.chat(sandboxId, {
 *   message: 'set up an agent that reacts to slack mentions',
 *   session_id: sessionId,
 * })) {
 *   if (evt.event === 'agent_text_delta') process.stdout.write(evt.data.text);
 *   if (evt.event === 'agent_finish') sessionId = evt.data.session_id;
 * }
 * ```
 */
export class ConciergeResource extends BaseResource {
  /** One-shot synchronous turn. Returns when the agent finishes. */
  async test(
    sandboxId: string,
    request: ConciergeTestRequest,
  ): Promise<ConciergeTestResponse> {
    return this.post<ConciergeTestResponse>(
      `${conciergeBase(sandboxId)}/test`,
      request,
    );
  }

  /**
   * Multi-turn streaming chat. Yields one `ConciergeEvent` per SSE
   * frame the server emits. Loop until you see `agent_finish` (or
   * `agent_error` — terminal).
   *
   * Cancellation: pass an `AbortSignal` via `options.signal` and call
   * `controller.abort()` to interrupt. The signal aborts the
   * underlying `fetch`, the server detects the disconnect via
   * `asyncio.CancelledError`, and the run row is marked `cancelled`.
   * Breaking out of the iterator alone is not enough — without a
   * signal, the TCP connection stays open and the agent keeps running
   * server-side.
   */
  async *chat(
    sandboxId: string,
    request: ConciergeChatRequest,
    options: { signal?: AbortSignal } = {},
  ): AsyncIterable<ConciergeEvent> {
    const response = await this.http.streamRequest(
      `${conciergeBase(sandboxId)}/chat`,
      { method: 'POST', body: request, signal: options.signal },
    );
    for await (const frame of parseSSE(response)) {
      yield narrowConciergeEvent(frame);
    }
  }
}

/**
 * Narrow a generic SSE frame to the discriminated `ConciergeEvent`
 * union. Unknown event names pass through as `{event, data}` so the
 * caller can handle forward-compatible additions; consumers that
 * only `switch` on known events will skip them implicitly.
 */
function narrowConciergeEvent(frame: SSEEvent): ConciergeEvent {
  // The discriminated union below mirrors the wire shapes emitted by
  // `frame_graph/copass_id/api/concierge.py`. TypeScript's narrowing
  // requires a runtime check on `event`; the data shape is
  // server-trusted (we don't validate field-by-field at parse time).
  return frame as ConciergeEvent;
}
