import * as fs from 'fs-extra';
import * as path from 'node:path';
import { DEFAULT_CONFIG_PATH, DEFAULT_INSTANCE_PATH } from '@olane/o-core';
import type {
  CreateWorldOptions,
  WorldAddressEntry,
  WorldFile,
  WorldRecord,
} from './types.js';

/**
 * Resolve the worlds directory for an OS instance.
 *
 * Convention: `<DEFAULT_CONFIG_PATH>/storage/<instanceName>/worlds/`.
 * Matches both `DEFAULT_CONFIG_PATH` and the `DEFAULT_INSTANCE_PATH + '..'` layout
 * used in different parts of the Olane stack.
 */
export function resolveWorldsDir(instanceName: string): string {
  return path.join(DEFAULT_CONFIG_PATH, 'storage', instanceName, 'worlds');
}

/** Convert a human world name to an `id` slug (`world-<kebab>`). */
export function slugifyWorldName(name: string): string {
  return `world-${name.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`;
}

async function readWorldFile(file: string): Promise<WorldFile | null> {
  try {
    const data = (await fs.readJson(file)) as Partial<WorldFile> | WorldRecord;
    // Legacy shape was the bare WorldRecord; newer shape wraps it in `{ config, addresses }`.
    const maybeFile = data as Partial<WorldFile>;
    if (maybeFile.config && typeof maybeFile.config === 'object') {
      return {
        config: maybeFile.config as WorldRecord,
        addresses: maybeFile.addresses ?? [],
      };
    }
    return {
      config: data as WorldRecord,
      addresses: [],
    };
  } catch {
    return null;
  }
}

/** List every world under an OS instance's worlds directory. */
export async function listLocalWorlds(
  instanceName: string,
): Promise<Array<WorldFile & { file: string }>> {
  const dir = resolveWorldsDir(instanceName);
  await fs.ensureDir(dir);
  let entries: string[] = [];
  try {
    entries = (await fs.readdir(dir)).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  const out: Array<WorldFile & { file: string }> = [];
  for (const name of entries) {
    const parsed = await readWorldFile(path.join(dir, name));
    if (parsed) out.push({ ...parsed, file: name });
  }
  return out;
}

/** True if at least one world JSON exists under the instance. */
export async function hasAnyLocalWorld(instanceName: string): Promise<boolean> {
  const worlds = await listLocalWorlds(instanceName);
  return worlds.length > 0;
}

/**
 * Create a world file on disk. Safe to call when the worlds directory is missing.
 *
 * Returns the persisted `WorldRecord`. Does not prompt or log.
 */
export async function createLocalWorld(
  instanceName: string,
  options: CreateWorldOptions,
): Promise<WorldRecord> {
  const dir = resolveWorldsDir(instanceName);
  await fs.ensureDir(dir);

  const id = slugifyWorldName(options.name);
  const record: WorldRecord = {
    id,
    name: options.name,
    description: options.description,
    icon: options.icon,
    supportedTypes: options.supportedTypes ?? ['filepath'],
    members: [],
    createdAt: new Date().toISOString(),
  };

  const file: WorldFile = { config: record, addresses: [] };
  await fs.writeJson(path.join(dir, `${id}.json`), file, { spaces: 2 });
  return record;
}

/**
 * Register or update a `filepath`-typed address on a world.
 *
 * Returns `null` if the world file does not exist.
 */
export async function registerWorldAddress(
  instanceName: string,
  worldName: string,
  filepath: string,
  type = 'filepath',
): Promise<WorldAddressEntry | null> {
  const id = slugifyWorldName(worldName);
  const file = path.join(resolveWorldsDir(instanceName), `${id}.json`);
  if (!(await fs.pathExists(file))) return null;

  const data = (await fs.readJson(file)) as WorldFile;
  if (!data.addresses) data.addresses = [];

  const entry: WorldAddressEntry = {
    address: filepath,
    type,
    registeredAt: new Date().toISOString(),
  };

  const existingIdx = data.addresses.findIndex((a) => a.address === filepath);
  if (existingIdx >= 0) {
    data.addresses[existingIdx] = entry;
  } else {
    data.addresses.push(entry);
  }

  await fs.writeJson(file, data, { spaces: 2 });
  return entry;
}

/** List every `filepath`-typed address in a single world. Returns `null` if the world is missing. */
export async function listWorldFilepaths(
  instanceName: string,
  worldName: string,
): Promise<WorldAddressEntry[] | null> {
  const id = slugifyWorldName(worldName);
  const file = path.join(resolveWorldsDir(instanceName), `${id}.json`);
  if (!(await fs.pathExists(file))) return null;
  const data = (await fs.readJson(file)) as WorldFile;
  return (data.addresses ?? []).filter((a) => a.type === 'filepath');
}

/**
 * Alternate worlds directory used by some older install layouts
 * (`<DEFAULT_INSTANCE_PATH>/../storage/<instance>/worlds`). Exposed so callers
 * that write to one layout can still read from the other.
 */
export function resolveLegacyWorldsDir(instanceName: string): string {
  return path.join(DEFAULT_INSTANCE_PATH, '..', 'storage', instanceName, 'worlds');
}
