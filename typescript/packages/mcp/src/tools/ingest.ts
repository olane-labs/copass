import { z } from 'zod';
import type { CopassClient } from '@copass/core';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerConfig } from '../config.js';

interface IngestDeps {
  client: CopassClient;
  config: ServerConfig;
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

export function registerIngestTool(server: McpServer, deps: IngestDeps): void {
  const { client, config } = deps;

  server.registerTool(
    'ingest',
    {
      description:
        'Push content into the knowledge graph via a data source. Use for: architecture ' +
        'decisions (source_type: "decision"), user-shared context ("user_input"), ' +
        'corrections ("correction"), durable notes, any significant new concept. Do NOT ' +
        'ingest trivial changes or ephemeral debug context — those belong in the Context ' +
        'Window (via context_window_add_turn). Pass `data_source_id` explicitly or set ' +
        '`COPASS_INGEST_DATA_SOURCE_ID` in the server env for an implicit target.',
      inputSchema: {
        content: z.string().min(1).describe('The content to ingest.'),
        source_type: z
          .string()
          .optional()
          .describe(
            'Type tag: code, markdown, json, text, conversation, decision, correction, ' +
              'user_input. Defaults to "text" when omitted.',
          ),
        data_source_id: z
          .string()
          .optional()
          .describe(
            'Target data source. Falls back to COPASS_INGEST_DATA_SOURCE_ID env var.',
          ),
        project_id: z.string().optional().describe('Override the server default project_id.'),
        storage_only: z
          .boolean()
          .optional()
          .describe('If true, chunk and store but skip ontology ingestion.'),
        occurred_at: z
          .string()
          .optional()
          .describe(
            'Optional ISO 8601 timestamp anchoring the content to a real-world moment ' +
              '(e.g. when this decision was made, when the user said it). Used as the ' +
              'default occurred_at for any composed event whose own timestamp is null, ' +
              'so temporal queries can find it.',
          ),
      },
    },
    async ({ content, source_type, data_source_id, project_id, storage_only, occurred_at }) => {
      try {
        const sourceId = data_source_id ?? config.ingest_data_source_id;
        if (!sourceId) {
          throw new Error(
            'ingest requires a `data_source_id` argument or COPASS_INGEST_DATA_SOURCE_ID env var. ' +
              'Register a data source via the REST API or CLI, then pass its id here.',
          );
        }

        const response = await client.sources.ingest(config.sandbox_id, sourceId, {
          text: content,
          source_type: source_type ?? 'text',
          project_id: project_id ?? config.project_id,
          storage_only,
          occurred_at,
        });

        return mcpResult({
          job_id: response.job_id,
          status: response.status,
          data_source_id: sourceId,
        });
      } catch (e) {
        return mcpError(e);
      }
    },
  );
}
