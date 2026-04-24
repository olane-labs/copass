/**
 * Minimal SSE (Server-Sent Events) parser for `text/event-stream` responses.
 *
 * Handles:
 * - CRLF and LF line endings
 * - Multi-line `data:` fields (concatenated per spec)
 * - `event:` field for message type
 * - Blank line as frame separator
 * - Ignores `:` comments, `id:`, `retry:`
 *
 * Copass's agent router emits frames tagged as `agent_text_delta`,
 * `agent_tool_call`, `agent_tool_result`, `agent_finish`, `agent_error`.
 */

import type {
  AgentEvent,
  AgentErrorEvent,
  AgentFinish,
  AgentTextDelta,
  AgentToolCall,
  AgentToolResult,
} from './events.js';

export interface RawSseFrame {
  event: string;
  data: string;
}

/** Parse one SSE frame block (events separated by blank lines). */
function parseBlock(block: string): RawSseFrame | null {
  let eventName = 'message';
  const dataLines: string[] = [];
  for (const rawLine of block.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (!line || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const field = line.slice(0, colon);
    // Strip one leading space after the colon per spec
    const value = line.slice(colon + 1).replace(/^ /, '');
    if (field === 'event') eventName = value;
    else if (field === 'data') dataLines.push(value);
  }
  if (dataLines.length === 0) return null;
  return { event: eventName, data: dataLines.join('\n') };
}

/** Async-iterate over SSE frames from a Fetch Response body. */
export async function* iterateSseFrames(
  response: Response,
): AsyncIterableIterator<RawSseFrame> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // Normalize CRLF → LF; split on blank line
      buffer = buffer.replace(/\r\n/g, '\n');
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const frame = parseBlock(block);
        if (frame) yield frame;
      }
    }
    // Flush trailing block if any
    if (buffer.trim()) {
      const frame = parseBlock(buffer);
      if (frame) yield frame;
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
  }
}

/** Translate a raw Copass SSE frame into the neutral `AgentEvent` union. */
export function frameToAgentEvent(frame: RawSseFrame): AgentEvent | null {
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(frame.data);
  } catch {
    return null;
  }
  switch (frame.event) {
    case 'agent_text_delta':
      return { type: 'text', text: String(payload.text ?? '') } as AgentTextDelta;
    case 'agent_tool_call':
      return {
        type: 'tool_call',
        call_id: String(payload.call_id ?? ''),
        name: String(payload.name ?? ''),
        arguments: (payload.arguments as Record<string, unknown>) ?? {},
      } as AgentToolCall;
    case 'agent_tool_result':
      return {
        type: 'tool_result',
        call_id: String(payload.call_id ?? ''),
        name: String(payload.name ?? ''),
        result: (payload.result as Record<string, unknown>) ?? {},
        error: (payload.error as string | null | undefined) ?? null,
      } as AgentToolResult;
    case 'agent_finish':
      return {
        type: 'finish',
        stop_reason: String(payload.stop_reason ?? 'unknown'),
        session_id: (payload.session_id as string | null | undefined) ?? null,
        usage: (payload.usage as Record<string, unknown>) ?? {},
      } as AgentFinish;
    case 'agent_error':
      return {
        type: 'error',
        message: String(payload.message ?? ''),
        errorType: String(payload.type ?? 'Error'),
      } as AgentErrorEvent;
    default:
      return null;
  }
}
