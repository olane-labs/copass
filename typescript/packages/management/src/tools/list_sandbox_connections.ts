import type { ToolContext, ToolHandler } from '../registrar.js';

/**
 * Wraps the bare-array SDK response in the ``{connections, count}``
 * envelope the spec requires. MCP's ``structuredContent`` rejects
 * bare arrays — every list-style tool must return an object.
 */
export const listSandboxConnections: ToolHandler = async (
  ctx: ToolContext,
  input: Record<string, unknown>,
) => {
  const connections = await ctx.client.sandboxConnections.list(ctx.sandboxId, {
    include_revoked: input.include_revoked === true,
  });
  return { connections, count: connections.length };
};
