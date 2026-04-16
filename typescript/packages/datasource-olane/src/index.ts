// Types
export type {
  OlaneTokenManagerOptions,
  WorldRecord,
  WorldAddressEntry,
  WorldFile,
  CreateWorldOptions,
  StartLocalOsOptions,
  StartLocalOsResult,
  RunLocalOsOptions,
  CreateAddressResult,
} from './types.js';

// Auth
export { createOlaneTokenManager } from './token-manager.js';

// OS instance lifecycle
export {
  startLocalOsInstance,
  runLocalOs,
  statusLocalOsInstance,
  stopLocalOsInstance,
  listLocalOsInstances,
  rotateLogFile,
} from './instance.js';

// Worlds
export {
  resolveWorldsDir,
  resolveLegacyWorldsDir,
  slugifyWorldName,
  listLocalWorlds,
  hasAnyLocalWorld,
  createLocalWorld,
  registerWorldAddress,
  listWorldFilepaths,
} from './worlds.js';

// Address book
export {
  createAddressForInstance,
  loadAddressBookEntries,
  addToAddressBook,
  removeFromAddressBook,
  describeAddressPaths,
  addressBookPath,
} from './address-book.js';
export type { AddressBookEntry, AddAddressOptions } from './address-book.js';

// Identity
export { getInstanceCopassId, setInstanceCopassId } from './identity.js';
