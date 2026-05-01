import type { CopassClient } from '@copass/core';
import type { ZodTypeAny } from 'zod';

import { jsonSchemaToZod } from './json-schema-to-zod.js';
import {
  loadManagementSpecs,
  type LoadOptions,
  type ManagementSpec,
} from './specs.js';
import { TOOL_HANDLERS } from './tools/index.js';

export interface ToolContext {
  client: CopassClient;
  sandboxId: string;
}

export type ToolHandler = (
  ctx: ToolContext,
  input: Record<string, unknown>,
) => Promise<unknown>;

export interface ToolRegistration {
  name: string;
  description: string;
  /** Raw JSON Schema for the tool's input. */
  inputSchema: Record<string, unknown>;
  /** Raw JSON Schema for the tool's output. */
  outputSchema: Record<string, unknown>;
  /** Compiled Zod parser for the input. */
  inputZod: ZodTypeAny;
  /** Compiled Zod parser for the output. */
  outputZod: ZodTypeAny;
  /** Async handler that runs the call and returns the parsed result. */
  handler: (input: unknown) => Promise<unknown>;
  /** The full spec object as loaded from disk. */
  spec: ManagementSpec;
}

export type Register = (registration: ToolRegistration) => void;

export interface RegistrarOptions extends LoadOptions {
  /** Sandbox the registered tools target. Required — every Phase 1 read tool
   * is sandbox-scoped. */
  sandboxId: string;
  /**
   * When true, validate the handler's HTTP response against the tool's
   * `outputSchema` before returning. Defaults to `false` because handlers
   * already pass through `@copass/core`-typed responses; the conformance
   * test enforces parity at build time. Enabling this adds runtime cost.
   */
  validateOutput?: boolean;
  /**
   * When true, silently skip spec entries that have no handler bound
   * in `TOOL_HANDLERS` rather than raising. Used by Phase 2A's
   * spec-only landing where the JSON Schemas + fixtures ship before
   * the per-tool TS / Python handler files (Phase 2B). Defaults to
   * `false` — production wiring should always pin every spec to a
   * handler.
   */
  allowMissingHandlers?: boolean;
}

/**
 * Transport-agnostic management-tool registrar.
 *
 * Loads the management spec corpus, builds Zod parsers for each tool's
 * input/output schema, wires every spec entry to its `@copass/core`
 * handler, and calls `register(...)` once per tool.
 *
 * The transport (MCP SDK, backend tool resolver, plain function table)
 * is the caller's concern.
 */
export function registerManagementTools(
  register: Register,
  client: CopassClient,
  options: RegistrarOptions,
): ToolRegistration[] {
  const corpus = loadManagementSpecs(options);
  const ctx: ToolContext = { client, sandboxId: options.sandboxId };
  const registrations: ToolRegistration[] = [];

  const names = Object.keys(corpus.specs).sort();
  for (const name of names) {
    const spec = corpus.specs[name];
    const handler = TOOL_HANDLERS[name];
    if (!handler) {
      if (options.allowMissingHandlers) {
        continue;
      }
      throw new Error(
        `registerManagementTools: no handler implementation for tool "${name}". Add one in src/tools/.`,
      );
    }

    const inputZod = jsonSchemaToZod(spec.inputSchema);
    const outputZod = jsonSchemaToZod(spec.outputSchema);

    const wrapped = async (rawInput: unknown): Promise<unknown> => {
      const parsedInput = inputZod.parse(rawInput ?? {}) as Record<string, unknown>;
      const result = await handler(ctx, parsedInput);
      if (options.validateOutput) {
        return outputZod.parse(result);
      }
      return result;
    };

    const registration: ToolRegistration = {
      name: spec.name,
      description: spec.description,
      inputSchema: spec.inputSchema,
      outputSchema: spec.outputSchema,
      inputZod,
      outputZod,
      handler: wrapped,
      spec,
    };

    register(registration);
    registrations.push(registration);
  }

  return registrations;
}
