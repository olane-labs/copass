import type { ToolContext, ToolHandler } from '../registrar.js';

export const purgeSourceContext: ToolHandler = async (
  ctx: ToolContext,
  input: Record<string, unknown>,
) => {
  const sourceId = String(input.data_source_id);
  const deleteSource =
    typeof input.delete_source === 'boolean' ? input.delete_source : undefined;
  return ctx.client.sources.purge(ctx.sandboxId, sourceId, {
    ...(deleteSource !== undefined ? { delete_source: deleteSource } : {}),
  });
};
