import type { ConnectRequest } from '@copass/core';

import type { ToolContext, ToolHandler } from '../registrar.js';

export const startIntegrationConnect: ToolHandler = async (
  ctx: ToolContext,
  input: Record<string, unknown>,
) => {
  const appSlug = String(input.app_slug);
  const successRedirect =
    typeof input.success_redirect_uri === 'string'
      ? input.success_redirect_uri
      : '';
  const errorRedirect =
    typeof input.error_redirect_uri === 'string'
      ? input.error_redirect_uri
      : '';
  const request: ConnectRequest = {
    success_redirect_uri: successRedirect,
    error_redirect_uri: errorRedirect,
  };
  if (typeof input.webhook_uri === 'string') {
    request.webhook_uri = input.webhook_uri;
  }
  return ctx.client.integrations.connect(ctx.sandboxId, appSlug, request);
};
