/**
 * File extension to language detection.
 *
 * Used to determine the `language` field when ingesting code files.
 */

import * as path from 'node:path';

export const DEFAULT_LANGUAGE_MAP: Record<string, string> = {
  // Core languages
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.py': 'python',
  '.rs': 'rust',
  '.go': 'go',
  '.java': 'java',
  '.rb': 'ruby',
  '.php': 'php',
  '.c': 'c',
  '.cpp': 'cpp',
  '.h': 'c',
  '.hpp': 'cpp',
  '.cs': 'csharp',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.scala': 'scala',
  '.sh': 'bash',
  '.sql': 'sql',
  // Markup / config
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.json': 'json',
  '.md': 'markdown',
  '.html': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.vue': 'vue',
  '.svelte': 'svelte',
  '.dockerfile': 'dockerfile',
  '.makefile': 'makefile',
  // Plain text / data
  '.txt': 'text-plain',
  '.csv': 'csv',
  '.tsv': 'tsv',
  '.xml': 'xml',
  '.toml': 'toml',
  '.ini': 'ini',
  '.cfg': 'ini',
  '.conf': 'config',
  '.env': 'dotenv',
  '.log': 'log',
  '.rst': 'restructuredtext',
  // Additional languages
  '.r': 'r',
  '.lua': 'lua',
  '.pl': 'perl',
  '.pm': 'perl',
  '.dart': 'dart',
  '.zig': 'zig',
  '.elm': 'elm',
  '.ex': 'elixir',
  '.exs': 'elixir',
  '.hs': 'haskell',
  '.tf': 'terraform',
  '.tfvars': 'terraform',
  '.m': 'objectivec',
  '.mm': 'objectivec',
  '.clj': 'clojure',
  '.cljs': 'clojure',
  '.erl': 'erlang',
  '.hrl': 'erlang',
  '.fs': 'fsharp',
  '.fsx': 'fsharp',
  '.jl': 'julia',
  '.groovy': 'groovy',
  '.gradle': 'groovy',
  '.v': 'v',
  '.nim': 'nim',
  '.cr': 'crystal',
  '.ml': 'ocaml',
  '.mli': 'ocaml',
  // Markup / templating
  '.graphql': 'graphql',
  '.gql': 'graphql',
  '.proto': 'protobuf',
  '.hbs': 'handlebars',
  '.ejs': 'ejs',
  '.pug': 'pug',
  '.less': 'less',
  '.sass': 'sass',
  '.styl': 'stylus',
  '.mdx': 'mdx',
  // Shell / scripting
  '.bash': 'bash',
  '.zsh': 'zsh',
  '.fish': 'fish',
  '.ps1': 'powershell',
  '.bat': 'batch',
  '.cmd': 'batch',
};

/**
 * Build a language map merged with optional extra language mappings.
 */
export function buildLanguageMap(extraLanguages?: Record<string, string>): Record<string, string> {
  if (!extraLanguages || Object.keys(extraLanguages).length === 0) {
    return DEFAULT_LANGUAGE_MAP;
  }
  return { ...DEFAULT_LANGUAGE_MAP, ...extraLanguages };
}

/**
 * Detect the language of a file based on its extension or basename.
 * Returns 'text' for unrecognized extensions.
 */
export function detectLanguage(filePath: string, extraLanguages?: Record<string, string>): string {
  const langMap = buildLanguageMap(extraLanguages);
  const baseName = path.basename(filePath).toLowerCase();
  const ext = path.extname(filePath).toLowerCase();
  if (baseName === 'dockerfile') return langMap['.dockerfile'];
  if (baseName === 'makefile') return langMap['.makefile'];
  return langMap[ext] || 'text';
}

/**
 * Check if a file path maps to a known code/config language (not plain 'text').
 */
export function isIndexableCodePath(
  filePath: string,
  extraLanguages?: Record<string, string>,
): boolean {
  return detectLanguage(filePath, extraLanguages) !== 'text';
}
