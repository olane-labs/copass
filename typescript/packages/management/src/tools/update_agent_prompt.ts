import type { ToolContext, ToolHandler } from '../registrar.js';

export const updateAgentPrompt: ToolHandler = async (
  ctx: ToolContext,
  input: Record<string, unknown>,
) => {
  const slug = String(input.slug);
  const agent = await ctx.client.agents.update(ctx.sandboxId, slug, {
    system_prompt: String(input.system_prompt),
  });
  return { agent };
};
