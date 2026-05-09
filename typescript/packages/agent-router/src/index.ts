export { AgentRouter, IntegrationsFacade } from './router.js';
export type { AgentRouterOptions, RunAgentOptions } from './router.js';

// Public Compute Router v1 (ADR 0020) — re-export the underlying type
// surface from `@copass/core` so consumers using `router.compute.*`
// don't have to add a second import for the types.
// ADR 0026 Phase 2 — also re-export the `ComputeSession` runtime
// wrapper (value) and the `ComputeGateway` envelope type.
export { ComputeSession } from '@copass/core';
export type {
  ComputeExecRequest,
  ComputeExecResponse,
  ComputeGateway,
  ComputeProvider,
  ComputeResource,
  ComputeSessionHealthResponse,
  ComputeSessionHealthStatus,
  ComputeSessionResponse,
  ComputeSessionStatus,
  ComputeTemplate,
  CreateComputeSessionRequest,
  ListComputeSessionsOptions,
  ListComputeSessionsResponse,
  ListComputeTemplatesOptions,
  ListComputeTemplatesResponse,
  StopComputeSessionResponse,
} from '@copass/core';
export {
  runConnectFlow,
} from './connect-flow.js';
export type { ConnectFlowOptions, ConnectFlowResult } from './connect-flow.js';
export type {
  AgentEvent,
  AgentEventType,
  AgentTextDelta,
  AgentToolCall,
  AgentToolResult,
  AgentFinish,
  AgentErrorEvent,
  AgentUsage,
  CostBreakdownMicrocents,
} from './events.js';
export { iterateSseFrames, frameToAgentEvent } from './sse.js';
export type { RawSseFrame } from './sse.js';
