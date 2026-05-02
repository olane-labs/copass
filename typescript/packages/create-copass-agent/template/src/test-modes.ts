/**
 * Preset-driven retrieval test modes.
 *
 * Bypasses the MCP + Agent SDK loop so each dropdown selection in the chat
 * UI maps 1:1 to a specific retrieval shape:
 *
 *  - `discover+interpret`     → /discover then /interpret on the top hits
 *  - `search`                 → /search with preset=`copass/1.0`
 *  - `search:thinking`        → /search with preset=`copass/1.0:thinking`
 *  - `search-2.0`             → /search with preset=`copass/2.0`
 *  - `search-2.0:thinking`    → /search with preset=`copass/2.0:thinking`
 *
 * Each call emits `tool-call` + `tool-result` events (just like agent mode)
 * so the UI renders identical collapsible cards — a preset run is shown as
 * a deterministic single-tool (or two-tool) trace instead of an agent loop.
 */

import type { ContextWindow, SearchPreset } from '@copass/core';
import { getCopass, getSandboxId } from './copass.js';
import type { StreamEvent } from './stream-events.js';

export const TEST_MODES = [
  'discover+interpret',
  'search',
  'search:thinking',
  'search-2.0',
  'search-2.0:thinking',
] as const;

export type TestMode = (typeof TEST_MODES)[number];

const MAX_INTERPRET_ITEMS = 4;

export async function* runTestModeStream(
  mode: TestMode,
  message: string,
  window: ContextWindow,
): AsyncGenerator<StreamEvent> {
  const client = getCopass();
  const sandboxId = getSandboxId();
  const project_id = process.env.COPASS_PROJECT_ID || undefined;

  if (mode === 'discover+interpret') {
    const discId = 'discover-1';
    yield {
      type: 'tool-call',
      id: discId,
      name: 'retrieval.discover',
      input: { query: message, sandbox_id: sandboxId, project_id },
    };
    const disc = await client.retrieval.discover(sandboxId, {
      query: message,
      window,
      project_id,
    });
    yield {
      type: 'tool-result',
      id: discId,
      name: 'retrieval.discover',
      output: {
        header: disc.header,
        count: disc.count,
        items: disc.items.slice(0, 10).map((i) => ({
          score: i.score,
          summary: i.summary,
          canonical_ids: i.canonical_ids,
        })),
        next_steps: disc.next_steps,
      },
    };

    const picks = disc.items.slice(0, MAX_INTERPRET_ITEMS);
    if (picks.length === 0) {
      yield { type: 'text', delta: `${disc.header}\n\n(no items returned; skipping /interpret)` };
      return;
    }

    const interpId = 'interpret-1';
    const items = picks.map((i) => i.canonical_ids);
    yield {
      type: 'tool-call',
      id: interpId,
      name: 'retrieval.interpret',
      input: { query: message, items, sandbox_id: sandboxId, project_id },
    };
    const brief = await client.retrieval.interpret(sandboxId, {
      query: message,
      items,
      window,
      project_id,
    });
    yield {
      type: 'tool-result',
      id: interpId,
      name: 'retrieval.interpret',
      output: { brief: brief.brief, citations: brief.citations },
    };
    yield { type: 'text', delta: brief.brief };
    return;
  }

  const preset = mapToSearchPreset(mode);
  const searchId = 'search-1';
  yield {
    type: 'tool-call',
    id: searchId,
    name: 'retrieval.search',
    input: { query: message, preset, sandbox_id: sandboxId, project_id },
  };
  const resp = await client.retrieval.search(sandboxId, {
    query: message,
    window,
    project_id,
    preset,
  });
  yield {
    type: 'tool-result',
    id: searchId,
    name: 'retrieval.search',
    output: {
      answer: resp.answer,
      preset: resp.preset,
      execution_time_ms: resp.execution_time_ms,
      warnings: resp.warnings,
    },
  };
  yield { type: 'text', delta: resp.answer };
}

function mapToSearchPreset(mode: Exclude<TestMode, 'discover+interpret'>): SearchPreset {
  switch (mode) {
    case 'search':
      return 'copass/1.0';
    case 'search:thinking':
      return 'copass/1.0:thinking';
    case 'search-2.0':
      return 'copass/2.0';
    case 'search-2.0:thinking':
      return 'copass/2.0:thinking';
  }
}
