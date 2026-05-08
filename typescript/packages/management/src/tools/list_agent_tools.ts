import type { ToolContext, ToolHandler } from '../registrar.js';

/**
 * Surfaces the agent tool catalog grouped by app_slug.
 *
 * The backend returns the flat ``{tools, count}`` shape; this handler
 * adds the ``by_app`` map the spec promises (``{[app_slug]: Tool[]}``)
 * so callers can render per-provider sections without re-grouping
 * client-side. Optional ``app_slug`` input filters the flat list AND
 * the by_app map to a single provider.
 */
export const listAgentTools: ToolHandler = async (
  ctx: ToolContext,
  input: Record<string, unknown>,
) => {
  const filterAppSlug =
    typeof input.app_slug === 'string' ? input.app_slug : undefined;

  const catalog = await ctx.client.agents.listTools(ctx.sandboxId);
  const tools = filterAppSlug
    ? catalog.tools.filter((t) => t.app_slug === filterAppSlug)
    : catalog.tools;

  const by_app: Record<
    string,
    Array<{ name: string; description?: string | null }>
  > = {};
  for (const tool of tools) {
    const slug = tool.app_slug || 'unknown';
    if (!by_app[slug]) by_app[slug] = [];
    by_app[slug].push({ name: tool.name, description: tool.description ?? null });
  }

  return { tools, by_app, count: tools.length };
};
