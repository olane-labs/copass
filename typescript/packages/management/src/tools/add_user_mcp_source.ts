import type { ToolContext, ToolHandler } from '../registrar.js';

type RegisterUserMcpRequest = Parameters<
  ToolContext['client']['sources']['registerUserMcp']
>[1];

export const addUserMcpSource: ToolHandler = async (
  ctx: ToolContext,
  input: Record<string, unknown>,
) => {
  const authKind = String(input.auth_kind) as RegisterUserMcpRequest['auth_kind'];
  const request: RegisterUserMcpRequest = {
    name: String(input.name),
    base_url: String(input.base_url),
    auth_kind: authKind,
  };
  if (typeof input.token === 'string') {
    request.token = input.token;
  }
  if (typeof input.auth_header === 'string') {
    request.auth_header = input.auth_header;
  }
  if (typeof input.app_namespace === 'string') {
    request.app_namespace = input.app_namespace;
  }
  if (Array.isArray(input.allowed_tools)) {
    request.allowed_tools = input.allowed_tools.map(String);
  }
  if (Array.isArray(input.ingest_tool_calls)) {
    request.ingest_tool_calls = input.ingest_tool_calls as Array<
      Record<string, unknown>
    >;
  }
  if (typeof input.rate_cap_per_minute === 'number') {
    request.rate_cap_per_minute = input.rate_cap_per_minute;
  }
  if (typeof input.webhook_rate_cap_per_minute === 'number') {
    request.webhook_rate_cap_per_minute = input.webhook_rate_cap_per_minute;
  }
  return ctx.client.sources.registerUserMcp(ctx.sandboxId, request);
};
