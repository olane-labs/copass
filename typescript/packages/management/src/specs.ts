import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

declare const __dirname: string | undefined;

export const MIN_SPEC_VERSION = 'v1';
export const MAX_SPEC_VERSION = 'v1';

export interface ManagementSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  since: string;
}

export interface ManagementFixture {
  input: Record<string, unknown>;
  output: Record<string, unknown>;
}

export interface LoadedManagementCorpus {
  specDir: string;
  specs: Record<string, ManagementSpec>;
  fixtures: Record<string, ManagementFixture>;
}

export interface LoadOptions {
  specDir?: string;
}

const ENV_OVERRIDE = 'COPASS_MANAGEMENT_SPEC_DIR';

function resolveModuleDir(): string {
  // CJS bundles inject `__dirname` directly; prefer it when present so we
  // don't trip the `import.meta` constraint in `verbatimModuleSyntax`.
  if (typeof __dirname === 'string') return __dirname;
  // ESM path: read `import.meta.url` via an indirect lookup so TS doesn't
  // require `module: esnext` for the file (it's still emitted as ESM).
  const metaUrl = (Function('return import.meta.url')() as string) ?? '';
  if (metaUrl) return dirname(fileURLToPath(metaUrl));
  return process.cwd();
}

function resolveDefaultSpecDir(): string {
  const envDir = process.env[ENV_OVERRIDE];
  if (envDir && envDir.trim().length > 0) {
    return resolve(envDir);
  }

  const here = resolveModuleDir();

  const bundled = resolve(here, 'specs', 'v1');
  if (existsSync(bundled)) return bundled;

  const sourceTree = resolve(here, '..', '..', '..', '..', 'spec', 'management', 'v1');
  if (existsSync(sourceTree)) return sourceTree;

  throw new Error(
    `loadManagementSpecs: could not locate spec directory. Tried bundled ${bundled} and source ${sourceTree}. Set ${ENV_OVERRIDE} to override.`,
  );
}

function assertSpecShape(name: string, raw: unknown): asserts raw is ManagementSpec {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`spec ${name}: not an object`);
  }
  const obj = raw as Record<string, unknown>;
  for (const required of ['name', 'description', 'inputSchema', 'outputSchema', 'since']) {
    if (!(required in obj)) {
      throw new Error(`spec ${name}: missing required field "${required}"`);
    }
  }
  if (typeof obj.name !== 'string' || typeof obj.description !== 'string') {
    throw new Error(`spec ${name}: name/description must be strings`);
  }
  if (typeof obj.since !== 'string') {
    throw new Error(`spec ${name}: since must be a string`);
  }
  if (typeof obj.inputSchema !== 'object' || typeof obj.outputSchema !== 'object') {
    throw new Error(`spec ${name}: inputSchema/outputSchema must be objects`);
  }
}

const JSON_SCHEMA_META_KEYS = new Set([
  '$schema',
  '$id',
  '$defs',
  '$ref',
  '$comment',
]);

function stripJsonSchemaMeta(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripJsonSchemaMeta);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (JSON_SCHEMA_META_KEYS.has(k)) continue;
      out[k] = stripJsonSchemaMeta(v);
    }
    return out;
  }
  return value;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

/**
 * Load every `<tool>.json` and matching `examples/<tool>.example.json`
 * fixture from the management spec directory.
 *
 * Resolution order for `specDir`:
 * 1. Explicit option, when passed
 * 2. `COPASS_MANAGEMENT_SPEC_DIR` env override
 * 3. Bundled `dist/specs/v1/`
 * 4. Source-tree `copass/spec/management/v1/` (dev mode)
 */
export function loadManagementSpecs(options: LoadOptions = {}): LoadedManagementCorpus {
  const specDir = options.specDir ? resolve(options.specDir) : resolveDefaultSpecDir();

  if (!existsSync(specDir) || !statSync(specDir).isDirectory()) {
    throw new Error(`loadManagementSpecs: ${specDir} is not a directory`);
  }

  const specs: Record<string, ManagementSpec> = {};
  for (const entry of readdirSync(specDir)) {
    if (!entry.endsWith('.json')) continue;
    const file = join(specDir, entry);
    if (!statSync(file).isFile()) continue;
    const raw = readJson(file);
    assertSpecShape(entry, raw);
    const cleaned: ManagementSpec = {
      ...raw,
      inputSchema: stripJsonSchemaMeta(raw.inputSchema) as Record<string, unknown>,
      outputSchema: stripJsonSchemaMeta(raw.outputSchema) as Record<string, unknown>,
    };
    specs[cleaned.name] = cleaned;
  }

  const fixtures: Record<string, ManagementFixture> = {};
  const examplesDir = join(specDir, 'examples');
  if (existsSync(examplesDir) && statSync(examplesDir).isDirectory()) {
    for (const entry of readdirSync(examplesDir)) {
      if (!entry.endsWith('.example.json')) continue;
      const toolName = entry.slice(0, -'.example.json'.length);
      const file = join(examplesDir, entry);
      const raw = readJson(file) as Record<string, unknown>;
      if (!raw || typeof raw !== 'object' || !('input' in raw) || !('output' in raw)) {
        throw new Error(`fixture ${entry}: must have "input" and "output" keys`);
      }
      fixtures[toolName] = raw as unknown as ManagementFixture;
    }
  }

  return { specDir, specs, fixtures };
}
