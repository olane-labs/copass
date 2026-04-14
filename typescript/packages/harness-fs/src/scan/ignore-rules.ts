/**
 * Default ignore rules for file scanning.
 *
 * These are always applied in addition to .gitignore and per-project config.
 */

/** Directories that are always ignored (never traversed). */
export const ALWAYS_IGNORED_DIRS = new Set(['.git', '.olane', '.claude', 'node_modules']);

/** Directories excluded by default (can be extended via config). */
export const DEFAULT_EXCLUDED_DIRS = new Set([
  '__pycache__',
  '.next',
  'dist',
  'build',
  '.venv',
  'venv',
  '.tox',
  '.mypy_cache',
  '.pytest_cache',
  'coverage',
  'vendor',
  'target',
  '.idea',
  '.vscode',
  '.eggs',
  'egg-info',
  '.terraform',
  '.serverless',
  '.aws-sam',
  '.cache',
  '.parcel-cache',
]);

/** File patterns excluded by default (globs matched against basename and relative path). */
export const DEFAULT_EXCLUDED_PATTERNS = [
  '*.lock',
  '*.min.js',
  '*.min.css',
  '*.pyc',
  '*.pyo',
  '*.so',
  '*.dylib',
  '*.dll',
  '*.exe',
  '*.o',
  '*.a',
  '*.class',
  '*.jar',
  '*.png',
  '*.jpg',
  '*.jpeg',
  '*.gif',
  '*.ico',
  '*.svg',
  '*.webp',
  '*.pdf',
  '*.zip',
  '*.tar',
  '*.gz',
  '*.bz2',
  '*.woff',
  '*.woff2',
  '*.ttf',
  '*.eot',
  '*.map',
  '*.chunk.js',
  '*.chunk.css',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'Cargo.lock',
  'poetry.lock',
  'Gemfile.lock',
  'composer.lock',
];

export function buildExcludedDirs(extraIgnoredDirs?: string[]): Set<string> {
  if (!extraIgnoredDirs || extraIgnoredDirs.length === 0) {
    return DEFAULT_EXCLUDED_DIRS;
  }
  return new Set([...DEFAULT_EXCLUDED_DIRS, ...extraIgnoredDirs]);
}
