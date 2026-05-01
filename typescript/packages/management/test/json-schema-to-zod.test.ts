import { describe, it, expect } from 'vitest';
import { z } from 'zod';

import { jsonSchemaToZod } from '../src/json-schema-to-zod.js';

describe('jsonSchemaToZod — description preservation (Phase 2A audit follow-up)', () => {
  it('attaches the top-level object description', () => {
    const node = jsonSchemaToZod({
      type: 'object',
      description: 'top-level prose',
      properties: {},
    });
    expect(node.description).toBe('top-level prose');
  });

  it('preserves per-property descriptions on the resulting object shape', () => {
    const node = jsonSchemaToZod({
      type: 'object',
      properties: {
        slug: {
          type: 'string',
          description: 'agent slug',
        },
        version: {
          type: 'integer',
          description: 'monotonic counter',
        },
      },
      required: ['slug'],
    });

    // Walk into the Zod object's shape and assert each branch carries
    // the JSON-Schema description through to the runtime metadata.
    const shape = (node as unknown as z.ZodObject<{
      slug: z.ZodTypeAny;
      version: z.ZodTypeAny;
    }>).shape;
    expect(shape.slug.description).toBe('agent slug');

    // version is optional — for the optional-wrapped case the inner
    // type carries the description.
    const versionInner =
      shape.version instanceof z.ZodOptional
        ? (shape.version as unknown as z.ZodOptional<z.ZodTypeAny>).unwrap()
        : shape.version;
    expect(versionInner.description).toBe('monotonic counter');
  });

  it('preserves descriptions on string scalars', () => {
    const node = jsonSchemaToZod({
      type: 'string',
      description: 'a string',
    });
    expect(node.description).toBe('a string');
  });

  it('preserves descriptions on array schemas', () => {
    const node = jsonSchemaToZod({
      type: 'array',
      description: 'a list of slugs',
      items: { type: 'string' },
    });
    expect(node.description).toBe('a list of slugs');
  });

  it('preserves descriptions on multi-type unions (e.g. ["array", "null"])', () => {
    const node = jsonSchemaToZod({
      type: ['array', 'null'],
      description: 'list or null',
      items: { type: 'string' },
    });
    expect(node.description).toBe('list or null');
  });

  it('preserves descriptions on oneOf variants at the top', () => {
    const node = jsonSchemaToZod({
      description: 'union prose',
      oneOf: [
        { type: 'string' },
        { type: 'null' },
      ],
    });
    expect(node.description).toBe('union prose');
  });

  it('does not crash on schemas without a description', () => {
    const node = jsonSchemaToZod({
      type: 'object',
      properties: { x: { type: 'string' } },
    });
    expect(node.description).toBeUndefined();
    // Still parses normally.
    expect(() => node.parse({ x: 'hello' })).not.toThrow();
  });
});
