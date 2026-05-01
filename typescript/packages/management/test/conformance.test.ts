import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import {
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';

import {
  jsonSchemaToZod,
  loadManagementSpecs,
  MIN_SPEC_VERSION,
  MAX_SPEC_VERSION,
  TOOL_HANDLERS,
} from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const sourceSpecDir = resolve(here, '..', '..', '..', '..', 'spec', 'management', 'v1');

// Per-tool parsed-output emit dir for the cross-language equivalence
// check (`scripts/conformance_check.sh`). The companion Python suite
// writes the same shape under `/tmp/conformance/py/<tool>.json` and
// the shell script `diff -r`s the two trees. Disabled when the env
// var is unset so local `vitest run` doesn't litter /tmp.
const PARSED_OUTPUT_DIR = process.env.CONFORMANCE_TS_OUT;

describe('@copass/management conformance', () => {
  const corpus = loadManagementSpecs({ specDir: sourceSpecDir });

  beforeAll(() => {
    if (PARSED_OUTPUT_DIR) {
      // Wipe + recreate so a stale /tmp tree from a previous run can't
      // mask a new divergence.
      if (existsSync(PARSED_OUTPUT_DIR)) {
        rmSync(PARSED_OUTPUT_DIR, { recursive: true, force: true });
      }
      mkdirSync(PARSED_OUTPUT_DIR, { recursive: true });
    }
  });

  afterAll(() => {
    if (PARSED_OUTPUT_DIR) {
      // Sanity gate: if the directory is empty after the suite runs,
      // the shell script's diff would falsely pass. Make that loud.
      const expectedFiles = Object.keys(corpus.specs).length;
      // Count by re-listing on disk so a misnamed write is caught.
      const fs = require('node:fs') as typeof import('node:fs');
      const written = fs
        .readdirSync(PARSED_OUTPUT_DIR)
        .filter((f) => f.endsWith('.json'));
      if (written.length !== expectedFiles) {
        throw new Error(
          `conformance: expected ${expectedFiles} parsed-output files in ${PARSED_OUTPUT_DIR}, found ${written.length}`,
        );
      }
    }
  });

  it('declares supported spec versions', () => {
    expect(MIN_SPEC_VERSION).toBe('v1');
    expect(MAX_SPEC_VERSION).toBe('v1');
  });

  it('loads the 14 Phase 1 read tools and the 6 Phase 2A write specs', () => {
    const names = Object.keys(corpus.specs).sort();
    expect(names).toEqual(
      [
        // Phase 1 read tools (since: "v1").
        'get_agent',
        'get_run_trace',
        'get_source',
        'list_agent_tools',
        'list_agents',
        'list_api_keys',
        'list_apps',
        'list_connected_accounts',
        'list_runs',
        'list_sandbox_connections',
        'list_sandboxes',
        'list_sources',
        'list_trigger_components',
        'list_triggers',
        // Phase 2A write specs (since: "v1.1"). Handlers land in Phase 2B.
        'add_user_mcp_source',
        'create_agent',
        'update_agent_prompt',
        'update_agent_tool_sources',
        'update_agent_tools',
        'wire_integration_to_agent',
      ].sort(),
    );
    expect(names.length).toBe(20);
  });

  it('has a fixture for every tool', () => {
    for (const name of Object.keys(corpus.specs)) {
      expect(corpus.fixtures[name], `missing fixture for ${name}`).toBeDefined();
    }
  });

  // Phase 2A intentionally ships specs + fixtures for the 6 write
  // tools but defers TS / Python handler implementations to Phase 2B.
  // The handler-binding assertion stays pinned to the Phase 1 read
  // surface; once Phase 2B lands, this set extends to the full 20-tool
  // corpus without any test scaffolding change.
  const PHASE_2B_PENDING_HANDLERS = new Set<string>([
    'add_user_mcp_source',
    'create_agent',
    'update_agent_prompt',
    'update_agent_tool_sources',
    'update_agent_tools',
    'wire_integration_to_agent',
  ]);

  it('has a TS handler bound for every Phase 1 read tool', () => {
    for (const name of Object.keys(corpus.specs)) {
      if (PHASE_2B_PENDING_HANDLERS.has(name)) continue;
      expect(TOOL_HANDLERS[name], `missing handler for ${name}`).toBeTypeOf('function');
    }
  });

  describe('every fixture round-trips through Zod', () => {
    for (const [name, spec] of Object.entries(corpus.specs)) {
      const fixture = corpus.fixtures[name];
      if (!fixture) continue;
      it(`${name}: input parses against inputSchema`, () => {
        const inputZod = jsonSchemaToZod(spec.inputSchema);
        expect(() => inputZod.parse(fixture.input)).not.toThrow();
      });
      it(`${name}: output parses against outputSchema`, () => {
        const outputZod = jsonSchemaToZod(spec.outputSchema);
        expect(() => outputZod.parse(fixture.output)).not.toThrow();
      });
      it(`${name}: round-trip JSON is byte-equivalent (key-sorted)`, () => {
        const inputZod = jsonSchemaToZod(spec.inputSchema);
        const outputZod = jsonSchemaToZod(spec.outputSchema);

        const parsedInput = inputZod.parse(fixture.input);
        const parsedOutput = outputZod.parse(fixture.output);

        expect(stableStringify(parsedInput)).toEqual(stableStringify(fixture.input));
        expect(stableStringify(parsedOutput)).toEqual(stableStringify(fixture.output));

        if (PARSED_OUTPUT_DIR) {
          // Emit the PARSED values (post Zod-coercion) under a stable
          // canonical form so `scripts/conformance_check.sh` can diff
          // them against the Python suite's `model_dump`-equivalent
          // output. Any cross-language divergence (e.g. Pydantic
          // int-coerces "5" where Zod rejects it) shows up as a real
          // diff.
          const path = `${PARSED_OUTPUT_DIR}/${name}.json`;
          const payload = {
            input: sortKeys(parsedInput),
            output: sortKeys(parsedOutput),
          };
          writeFileSync(path, JSON.stringify(payload, null, 2));
        }
      });
    }
  });
});

function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}
