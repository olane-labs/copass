import type {
  AgentBackend,
  AgentModelSettings,
  CreateAgentRequest,
} from '@copass/core';

import type { ToolContext, ToolHandler } from '../registrar.js';

export const createAgent: ToolHandler = async (
  ctx: ToolContext,
  input: Record<string, unknown>,
) => {
  const backend: AgentBackend =
    input.backend === 'google' ? 'google' : 'anthropic';
  const defaultModel =
    backend === 'anthropic' ? 'claude-sonnet-4-6' : 'gemini-2.5-flash';

  const modelSettings: AgentModelSettings = {
    backend,
    model: typeof input.model === 'string' ? input.model : defaultModel,
  };
  if (typeof input.temperature === 'number') {
    modelSettings.temperature = input.temperature;
  }
  if (typeof input.max_tokens === 'number') {
    modelSettings.max_tokens = input.max_tokens;
  }
  if (typeof input.max_turns === 'number') {
    modelSettings.max_turns = input.max_turns;
  }
  if (typeof input.timeout_s === 'number') {
    modelSettings.timeout_s = input.timeout_s;
  }

  const request: CreateAgentRequest = {
    slug: String(input.slug),
    name: String(input.name),
    system_prompt: String(input.system_prompt),
    model_settings: modelSettings,
  };
  if (typeof input.description === 'string') {
    request.description = input.description;
  }
  if (Array.isArray(input.tool_allowlist)) {
    request.tool_allowlist = input.tool_allowlist.map(String);
  }

  const agent = await ctx.client.agents.create(ctx.sandboxId, request);
  return { agent };
};
