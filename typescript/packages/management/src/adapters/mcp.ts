import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z, type ZodTypeAny } from 'zod';
import type { CopassClient } from '@copass/core';

import {
  registerManagementTools,
  type RegistrarOptions,
  type ToolRegistration,
} from '../registrar.js';

/**
 * Extract the per-property shape from a compiled Zod schema in a form
 * the MCP SDK accepts (a ``ZodRawShape`` — a ``{ key: ZodType }`` map),
 * NOT the full ``ZodObject`` wrapper.
 *
 * Background: ``McpServer.registerTool({ inputSchema, outputSchema })``
 * iterates over the schema map and calls internal Zod accessors
 * (``._zod``, ``._def``, …) on each property. If we hand it a
 * ``ZodObject`` directly, MCP iterates over the object's own
 * properties (``_def``, ``parse``, ``shape``, etc. — none of which
 * are Zod schemas), then crashes with
 * ``Cannot read properties of undefined (reading '_zod')``.
 *
 * For tools whose schema isn't an object at the top level (e.g. union
 * via ``oneOf``, or ``z.unknown()``), MCP cannot represent it as a
 * tool schema at all — return ``undefined`` so the caller drops the
 * field entirely. The handler still validates the input/output via
 * the registrar's ``inputZod.parse`` / ``outputZod.parse``; only the
 * MCP-side schema advertisement is omitted.
 */
function toMcpShape(zod: ZodTypeAny): Record<string, ZodTypeAny> | undefined {
  if (zod instanceof z.ZodObject) {
    return (zod as z.ZodObject<Record<string, ZodTypeAny>>).shape;
  }
  return undefined;
}

/**
 * Wire every read-tool registration onto an MCP server. The MCP SDK is the
 * only dependency this adapter takes — the underlying registrar stays
 * transport-agnostic so backend Phase 3 can reuse it without pulling MCP.
 */
export function registerToMcpServer(
  server: McpServer,
  client: CopassClient,
  options: RegistrarOptions,
): ToolRegistration[] {
  return registerManagementTools(
    (registration) => {
      const inputShape = toMcpShape(registration.inputZod);
      const outputShape = toMcpShape(registration.outputZod);

      const toolConfig: {
        description: string;
        inputSchema?: Record<string, ZodTypeAny>;
        outputSchema?: Record<string, ZodTypeAny>;
      } = {
        description: registration.description,
      };
      // Only attach a schema when we can express it as a ZodRawShape.
      // Non-object top-level schemas (e.g. `oneOf` unions) are dropped
      // here — the registrar still validates inputs/outputs via its
      // compiled ZodObject parsers, so the contract is preserved; the
      // MCP-side advertisement just becomes "unknown shape".
      if (inputShape !== undefined) {
        toolConfig.inputSchema = inputShape;
      }
      if (outputShape !== undefined) {
        toolConfig.outputSchema = outputShape;
      }

      server.registerTool(
        registration.name,
        toolConfig as never,
        (async (rawInput: unknown) => {
          const result = await registration.handler(rawInput);
          const isObjectResult =
            typeof result === 'object' && result !== null;
          return {
            content: [
              {
                type: 'text',
                text:
                  typeof result === 'string'
                    ? result
                    : JSON.stringify(result, null, 2),
              },
            ],
            ...(isObjectResult
              ? { structuredContent: result as Record<string, unknown> }
              : {}),
          };
        }) as never,
      );
    },
    client,
    options,
  );
}
