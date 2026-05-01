import type { ToolContext, ToolHandler } from '../registrar.js';

export const wireIntegrationToAgent: ToolHandler = async (
  ctx: ToolContext,
  input: Record<string, unknown>,
) => {
  const agentSlug = String(input.agent_slug);
  const appSlug = String(input.app_slug);
  return ctx.client.agents.wireIntegration(ctx.sandboxId, agentSlug, appSlug);
};
