import { createReactAgent } from '@langchain/langgraph/prebuilt';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { StructuredToolInterface } from '@langchain/core/tools';
import type { Runnable, RunnableConfig } from '@langchain/core/runnables';
import type { BaseMessage } from '@langchain/core/messages';
import type { CopassClient, ContextWindow, SearchPreset } from '@copass/core';
import { copassTools } from './tools.js';
import { CopassWindowCallback } from './callback.js';

type ReactAgentExtraOptions = Omit<
  Parameters<typeof createReactAgent>[0],
  'llm' | 'tools'
>;

/**
 * Output type of {@link createCopassAgent}. A standard LangChain `Runnable`
 * producing `{ messages: BaseMessage[] }` on `.invoke()` / `.stream()`.
 *
 * The concrete inferred type (a LangGraph `CompiledStateGraph`) can't be
 * serialized into a portable declaration, so we expose the narrower
 * `Runnable` surface that's sufficient for every public method a caller
 * needs — `.invoke`, `.stream`, `.streamEvents`, `.batch`, `.pipe`,
 * `.withConfig`, etc. Escape hatch if you need the raw graph: cast the
 * result.
 */
export type CopassAgent = Runnable<
  { messages: BaseMessage[] } | BaseMessage[] | string,
  { messages: BaseMessage[] },
  RunnableConfig
>;

export interface CreateCopassAgentOptions extends ReactAgentExtraOptions {
  /** An authenticated `@copass/core` client. */
  client: CopassClient;
  /** Sandbox all retrieval runs against. */
  sandbox_id: string;
  /**
   * Context Window for this conversation thread. Turn history is mirrored
   * into it automatically across every chat model invocation — retrieval
   * becomes window-aware with no per-call wiring.
   */
  window: ContextWindow;
  /** The chat model (e.g. `new ChatAnthropic(...)`, `new ChatOpenAI(...)`). */
  llm: BaseChatModel;
  /** Additional tools to mix in alongside `discover` / `interpret` / `search`. */
  tools?: StructuredToolInterface[];
  /** Optional project scoping for retrieval. */
  project_id?: string;
  /** Preset for `interpret` / `search`. Default: `"copass/1.0"`. */
  preset?: SearchPreset;
  /** Include LangChain `ToolMessage`s in the Context Window. Default: `false`. */
  includeToolMessages?: boolean;
}

/**
 * Create a LangChain agent pre-wired with Copass retrieval tools and
 * window-aware memory.
 *
 * Returns a standard LangChain Runnable — call `.invoke()`, `.stream()`,
 * `.streamEvents()`, `.batch()` as you would with the output of
 * `createReactAgent`. The Copass Context Window is mirrored from the
 * conversation history automatically; you don't pass callbacks, trackers,
 * or lifecycle hooks.
 *
 * @example
 * ```ts
 * import { ChatAnthropic } from '@langchain/anthropic';
 * import { CopassClient } from '@copass/core';
 * import { createCopassAgent } from '@copass/langchain';
 *
 * const copass = new CopassClient({ auth: { type: 'bearer', token: process.env.COPASS_API_KEY! } });
 * const window = await copass.contextWindow.create({ sandbox_id });
 *
 * const agent = createCopassAgent({
 *   client: copass,
 *   sandbox_id,
 *   window,
 *   llm: new ChatAnthropic({ model: 'claude-opus-4-7' }),
 * });
 *
 * const result = await agent.invoke({
 *   messages: [{ role: 'user', content: 'why is checkout flaky?' }],
 * });
 * ```
 *
 * ### How the wiring works
 *
 * Under the hood this composes three primitives also exported from this
 * package — in case you want to build your own variant:
 *
 * - `copassTools({ client, sandbox_id, window, ... })` — the three retrieval
 *   tools, window-aware at the server call level.
 * - `createReactAgent({ llm, tools, ... })` — the standard LangGraph ReAct agent.
 * - `CopassWindowCallback({ window })` — bound via `Runnable.withConfig` so
 *   every chat model invocation auto-mirrors messages into the window.
 */
export function createCopassAgent(options: CreateCopassAgentOptions): CopassAgent {
  const {
    client,
    sandbox_id,
    window,
    llm,
    tools: extraTools = [],
    project_id,
    preset,
    includeToolMessages,
    ...reactAgentOptions
  } = options;

  const copass = copassTools({ client, sandbox_id, window, project_id, preset });
  const callback = new CopassWindowCallback({ window, includeToolMessages });

  const agent = createReactAgent({
    llm,
    tools: [copass.discover, copass.interpret, copass.search, ...extraTools],
    ...reactAgentOptions,
  });

  // `withConfig` returns a RunnableBinding that propagates these callbacks
  // to every child Runnable invocation — including the chat model calls
  // that trigger `CopassWindowCallback.handleChatModelStart`. The cast
  // narrows LangGraph's concrete graph type to the portable Runnable
  // surface we want to expose.
  return agent.withConfig({ callbacks: [callback] }) as unknown as CopassAgent;
}
