/**
 * Built-in ingestion transforms.
 *
 * Each transform takes content + options and returns transformed content.
 * Applied in declaration order within a pipeline.
 */

import type { IngestionTransform } from '../config/index.js';

type TransformFn = (content: string, options?: Record<string, unknown>) => string;

const COMMENT_PATTERNS = {
  singleLine: [
    /^\s*\/\/.*$/gm, // C-style //
    /^\s*#.*$/gm, // Shell/Python #
    /^\s*--.*$/gm, // SQL --
  ],
  block: [
    /\/\*[\s\S]*?\*\//g, // C-style /* */
    /"""[\s\S]*?"""/g, // Python docstrings """
    /'''[\s\S]*?'''/g, // Python docstrings '''
    /<!--[\s\S]*?-->/g, // HTML comments
  ],
};

function stripComments(content: string): string {
  let result = content;
  for (const pattern of COMMENT_PATTERNS.block) {
    result = result.replace(pattern, '');
  }
  for (const pattern of COMMENT_PATTERNS.singleLine) {
    result = result.replace(pattern, '');
  }
  result = result.replace(/\n{3,}/g, '\n\n');
  return result.trim();
}

function truncate(content: string, options?: Record<string, unknown>): string {
  const maxChars = options?.max_chars as number | undefined;
  const maxLines = options?.max_lines as number | undefined;

  let result = content;

  if (maxLines !== undefined) {
    const lines = result.split('\n');
    if (lines.length > maxLines) {
      result = lines.slice(0, maxLines).join('\n');
    }
  }

  if (maxChars !== undefined && result.length > maxChars) {
    result = result.slice(0, maxChars);
  }

  return result;
}

function prependContext(content: string, options?: Record<string, unknown>): string {
  const context = (options?.context as string) ?? '';
  if (!context) return content;
  return `${context}\n\n${content}`;
}

function customHeader(content: string, options?: Record<string, unknown>): string {
  const header = (options?.header as string) ?? '';
  if (!header) return content;
  return `${header}\n${content}`;
}

const TRANSFORM_REGISTRY: Record<string, TransformFn> = {
  strip_comments: (content) => stripComments(content),
  truncate: (content, options) => truncate(content, options),
  prepend_context: (content, options) => prependContext(content, options),
  custom_header: (content, options) => customHeader(content, options),
};

/**
 * Apply a sequence of transforms to content.
 * Transforms run in declaration order. Unknown transform types are skipped.
 */
export function applyTransforms(content: string, transforms: IngestionTransform[]): string {
  let result = content;
  for (const transform of transforms) {
    const fn = TRANSFORM_REGISTRY[transform.type];
    if (fn) {
      result = fn(result, transform.options as Record<string, unknown>);
    }
  }
  return result;
}
