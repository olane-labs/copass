export {
  scanProjectFiles,
  fingerprintProjectFile,
  diffFiles,
  shouldIgnorePath,
  createWatchPathMatcher,
  createEmptyWatchState,
} from './files.js';
export type { ScanOptions } from './files.js';
export { GitignoreFilter } from './gitignore.js';
export {
  ALWAYS_IGNORED_DIRS,
  DEFAULT_EXCLUDED_DIRS,
  DEFAULT_EXCLUDED_PATTERNS,
  buildExcludedDirs,
} from './ignore-rules.js';
