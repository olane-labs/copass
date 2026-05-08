import { z } from 'zod';
import type { CopassClient } from '@copass/core';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerConfig } from '../config.js';
import type { WindowRegistry } from '../windows.js';

interface ContextWindowDeps {
  client: CopassClient;
  config: ServerConfig;
  windows: WindowRegistry;
}

function mcpResult(payload: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
  };
}

function mcpError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: 'text' as const, text: `Error: ${message}` }],
    isError: true,
  };
}

export function registerContextWindowTools(server: McpServer, deps: ContextWindowDeps): void {
  const { client, config, windows } = deps;

  server.registerTool(
    'context_window_create',
    {
      description:
        'Open a new Context Window — an ephemeral data source tracking this conversation. ' +
        'Subsequent retrieval calls become automatically window-aware, and every turn you ' +
        'record via `context_window_add_turn` is ingested into the graph so past turns ' +
        'become retrievable. Returns a `data_source_id`; persist it on your side if you ' +
        'may want to resume this conversation later via `context_window_attach`. Pass ' +
        '`participants` to set a default conversation roster — forwarded as the envelope ' +
        '`participants` field on every turn so downstream extraction can resolve ' +
        'second-person pronouns ("your X" → the OTHER listed participant).',
      inputSchema: {
        project_id: z.string().optional().describe('Override the server default project_id.'),
        name: z.string().optional().describe('Optional stable name for the underlying data source.'),
        participants: z
          .array(z.string())
          .optional()
          .describe(
            'Default conversation participant roster (e.g. ["User", "Assistant"]). ' +
            'Forwarded on every turn unless add_turn passes its own override.',
          ),
      },
    },
    async ({ project_id, name, participants }) => {
      try {
        const window = await client.contextWindow.create({
          sandbox_id: config.sandbox_id,
          project_id: project_id ?? config.project_id,
          name,
          participants,
        });
        windows.set(window);
        return mcpResult({
          data_source_id: window.dataSourceId,
          active: true,
        });
      } catch (e) {
        return mcpError(e);
      }
    },
  );

  server.registerTool(
    'context_window_add_turn',
    {
      description:
        'Append a turn to the active Context Window and push it into the graph. Call on ' +
        'every user message AND every assistant message so the thread itself becomes ' +
        'retrievable. If you omit `data_source_id`, the active window is used. Pass `name` ' +
        'when the speaker has a richer identity than `role` alone (e.g. an actual user name ' +
        'like "Alice"); falls back to capitalized `role` when absent. Pass `participants` ' +
        'to override the window\'s default roster for this turn only.',
      inputSchema: {
        role: z
          .enum(['user', 'assistant', 'system'])
          .describe('Role of the speaker for this turn.'),
        content: z.string().describe('The turn content.'),
        name: z
          .string()
          .optional()
          .describe(
            'Optional named participant for this turn — forwarded as the envelope ' +
            '`speaker`. Caller-decided literal (e.g. "Alice", "support-bot"). When ' +
            'omitted, falls back to the capitalized role.',
          ),
        participants: z
          .array(z.string())
          .optional()
          .describe(
            'Per-turn participants override. Falls back to the window\'s ' +
            'constructor-time roster when omitted.',
          ),
        data_source_id: z
          .string()
          .optional()
          .describe('Override the active window id (for multi-window use cases).'),
      },
    },
    async ({ role, content, name, participants, data_source_id }) => {
      try {
        const window = windows.resolve(data_source_id);
        if (!window) {
          throw new Error(
            'No active Context Window — call context_window_create or context_window_attach first.',
          );
        }
        await window.addTurn({ role, content, name }, { participants });
        return mcpResult({
          data_source_id: window.dataSourceId,
          turn_count: window.getTurns().length,
        });
      } catch (e) {
        return mcpError(e);
      }
    },
  );

  server.registerTool(
    'context_window_attach',
    {
      description:
        'Resume an existing Context Window by `data_source_id` (one you previously persisted ' +
        'on your side after `context_window_create`). Makes the resumed window the active ' +
        'window. Pass `initial_turns` to seed the local buffer for immediate window-aware ' +
        'retrieval, otherwise the buffer starts empty and fills as you call add_turn.',
      inputSchema: {
        data_source_id: z.string().describe('Id of the Context Window data source to resume.'),
        initial_turns: z
          .array(
            z.object({
              role: z.enum(['user', 'assistant', 'system']),
              content: z.string(),
              name: z.string().optional(),
            }),
          )
          .optional()
          .describe('Optional pre-existing turns to seed the local buffer.'),
        participants: z
          .array(z.string())
          .optional()
          .describe(
            'Default conversation participant roster — forwarded on every turn ' +
            'pushed via add_turn unless that call overrides.',
          ),
      },
    },
    async ({ data_source_id, initial_turns, participants }) => {
      try {
        const window = await client.contextWindow.attach({
          sandbox_id: config.sandbox_id,
          data_source_id,
          initialTurns: initial_turns,
          participants,
        });
        windows.set(window);
        return mcpResult({
          data_source_id: window.dataSourceId,
          turn_count: window.getTurns().length,
          active: true,
        });
      } catch (e) {
        return mcpError(e);
      }
    },
  );

  server.registerTool(
    'context_window_close',
    {
      description:
        'Close a Context Window — flips the underlying data source to `disconnected` ' +
        'immediately instead of waiting for TTL. Best-effort; idempotent. If you omit ' +
        '`data_source_id`, the active window is closed.',
      inputSchema: {
        data_source_id: z
          .string()
          .optional()
          .describe('Override the active window id.'),
      },
    },
    async ({ data_source_id }) => {
      try {
        const window = windows.resolve(data_source_id);
        if (!window) {
          throw new Error('No active Context Window to close.');
        }
        await window.close();
        windows.drop(window.dataSourceId);
        return mcpResult({
          data_source_id: window.dataSourceId,
          closed: true,
        });
      } catch (e) {
        return mcpError(e);
      }
    },
  );
}
