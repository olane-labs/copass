// Types
export type * from './types.js';

// Scan
export {
  scanProjectFiles,
  fingerprintProjectFile,
  diffFiles,
  shouldIgnorePath,
  createWatchPathMatcher,
  createEmptyWatchState,
} from './scan/index.js';
export type { ScanOptions } from './scan/index.js';
export { GitignoreFilter } from './scan/index.js';
export {
  ALWAYS_IGNORED_DIRS,
  DEFAULT_EXCLUDED_DIRS,
  DEFAULT_EXCLUDED_PATTERNS,
} from './scan/index.js';

// Watch
export {
  readWatchState,
  writeWatchState,
  rebuildWatchState,
  appendWatchLog,
} from './watch/index.js';
export { ProjectWatchRuntime } from './watch/index.js';
export type { WatchRunSummary } from './watch/index.js';
export { planIncrementalIndex, runIncrementalIndex } from './watch/index.js';
export type { IncrementalIndexPlan } from './watch/index.js';

// Service
export {
  buildWatchServiceId,
  buildWatchServiceDefinition,
  installWatchService,
  uninstallWatchService,
  getWatchServiceStatus,
} from './service/index.js';

// Indexer
export { runFullIndex } from './indexer/index.js';
