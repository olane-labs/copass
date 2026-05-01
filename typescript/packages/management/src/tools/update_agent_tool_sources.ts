import type { ToolContext, ToolHandler } from '../registrar.js';

export const updateAgentToolSources: ToolHandler = async (
  ctx: ToolContext,
  input: Record<string, unknown>,
) => {
  const slug = String(input.slug);
  const raw = input.tool_sources;
  const toolSources: string[] | null =
    raw === null
      ? null
      : Array.isArray(raw)
        ? raw.map(String)
        : null;
  const agent = await ctx.client.agents.updateToolSources(
    ctx.sandboxId,
    slug,
    toolSources,
  );
  return { agent };
};
