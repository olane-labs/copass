import * as path from 'node:path';
import { AddressBook, AddressFactory } from '@olane/os';
import { listLocalWorlds } from './worlds.js';
import type { CreateAddressResult, WorldAddressEntry } from './types.js';

export interface AddressBookEntry {
  address: string;
  type: string;
  alias?: string;
}

export interface AddAddressOptions {
  /** `external` means "belongs to another OS"; `internal` is this instance. */
  external?: boolean;
  alias?: string;
}

/**
 * Create a new o:// address and surface enough context for the caller to
 * decide whether to register it with one of the instance's worlds.
 *
 * Pure: does not prompt, write, or log. The caller handles UX.
 */
export async function createAddressForInstance(
  instanceName: string,
  name: string,
  cwd: string = process.cwd(),
): Promise<CreateAddressResult> {
  const addr = AddressFactory.createAddress(name);
  const worlds = (await listLocalWorlds(instanceName)).map((w) => ({
    id: w.config.id,
    name: w.config.name,
    file: w.file,
  }));

  // Duplicate detection — is the current cwd already registered in any world?
  const worldsWithAddresses = await listLocalWorlds(instanceName);
  const duplicateWorld = worldsWithAddresses.find((w) =>
    (w.addresses ?? []).some((a: WorldAddressEntry) => a.address === cwd),
  );

  return {
    address: addr.value,
    worlds,
    duplicateInWorld: duplicateWorld
      ? { id: duplicateWorld.config.id, name: duplicateWorld.config.name }
      : undefined,
  };
}

export async function loadAddressBookEntries(instanceName: string) {
  const book = new AddressBook(instanceName);
  await book.load();
  return book.list();
}

export async function addToAddressBook(
  instanceName: string,
  address: string,
  options: AddAddressOptions = {},
): Promise<void> {
  const book = new AddressBook(instanceName);
  await book.load();
  await book.add({
    address,
    type: options.external ? 'external' : 'internal',
    alias: options.alias,
  });
}

export async function removeFromAddressBook(
  instanceName: string,
  address: string,
): Promise<boolean> {
  const book = new AddressBook(instanceName);
  await book.load();
  return book.remove(address);
}

/** Convenience: compute the two public paths produced by a newly-created address. */
export function describeAddressPaths(
  instanceName: string,
  name: string,
  worldName: string,
): { short: string; qualified: string } {
  const slug = worldName.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  return {
    short: `o://${name}`,
    qualified: `o://${instanceName}/worlds/${slug}/${name}`,
  };
}

/** Re-export the underlying path join helper for callers that want to match the convention. */
export const addressBookPath = (instanceName: string) =>
  path.join('os-instance', instanceName, 'address-book.json');
