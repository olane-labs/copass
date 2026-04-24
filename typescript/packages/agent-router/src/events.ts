/**
 * Provider-neutral agent event types — mirrors `copass_core_agents.events`
 * on the Python side so consumers get the same shape regardless of SDK.
 */

export type AgentEventType =
  | 'text'
  | 'tool_call'
  | 'tool_result'
  | 'finish'
  | 'error';

export interface AgentTextDelta {
  type: 'text';
  text: string;
}

export interface AgentToolCall {
  type: 'tool_call';
  call_id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface AgentToolResult {
  type: 'tool_result';
  call_id: string;
  name: string;
  result: Record<string, unknown>;
  error?: string | null;
}

export interface AgentFinish {
  type: 'finish';
  stop_reason: string;
  /** Provider-managed conversation handle. Pass back to continue. */
  session_id?: string | null;
  usage: Record<string, unknown>;
}

export interface AgentErrorEvent {
  type: 'error';
  message: string;
  errorType: string;
}

export type AgentEvent =
  | AgentTextDelta
  | AgentToolCall
  | AgentToolResult
  | AgentFinish
  | AgentErrorEvent;
