import type { ToolContext, ToolHandler } from '../registrar.js';

export const updateAgentTools: ToolHandler = async (
  ctx: ToolContext,
  input: Record<string, unknown>,
) => {
  const slug = String(input.slug);
  const toolAllowlist = Array.isArray(input.tool_allowlist)
    ? input.tool_allowlist.map(String)
    : [];
  const agent = await ctx.client.agents.update(ctx.sandboxId, slug, {
    tool_allowlist: toolAllowlist,
  });
  return { agent };
};
