import { z, type ZodTypeAny } from 'zod';

type Schema = Record<string, unknown> & { type?: string | string[] };

function describeIfPresent(node: ZodTypeAny, schema: Schema): ZodTypeAny {
  const description = schema.description;
  if (typeof description === 'string' && description.length > 0) {
    return node.describe(description);
  }
  return node;
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function buildScalarForType(type: string): ZodTypeAny {
  switch (type) {
    case 'string':
      return z.string();
    case 'integer':
      return z.number().int();
    case 'number':
      return z.number();
    case 'boolean':
      return z.boolean();
    case 'null':
      return z.null();
    case 'array':
      return z.array(z.unknown());
    case 'object':
      return z.record(z.string(), z.unknown());
    default:
      return z.unknown();
  }
}

function applyStringConstraints(schema: Schema, base: ZodTypeAny): ZodTypeAny {
  if ((schema.type === 'string' || (Array.isArray(schema.type) && schema.type.includes('string'))) && schema.format === 'date-time') {
    // Permissive: accept any string. JSON Schema's date-time is just a hint.
    return base;
  }
  return base;
}

function buildEnum(schema: Schema): ZodTypeAny | undefined {
  const enumValues = schema.enum as unknown[] | undefined;
  if (!enumValues || !Array.isArray(enumValues) || enumValues.length === 0) return undefined;
  const literals: ZodTypeAny[] = enumValues.map((value) => {
    if (value === null) return z.null();
    if (typeof value === 'string') return z.literal(value);
    if (typeof value === 'number') return z.literal(value);
    if (typeof value === 'boolean') return z.literal(value);
    return z.literal(value as never);
  });
  if (literals.length === 1) return literals[0];
  return z.union(literals as unknown as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]]);
}

function buildForType(schema: Schema, type: string): ZodTypeAny {
  if (type === 'array') {
    const items = (schema.items as Schema | undefined) ?? {};
    return z.array(jsonSchemaToZod(items));
  }
  if (type === 'object') {
    const properties = (schema.properties as Record<string, Schema> | undefined) ?? {};
    const required = new Set(asArray(schema.required as string | string[] | undefined));
    const shape: Record<string, ZodTypeAny> = {};
    for (const [key, subSchema] of Object.entries(properties)) {
      const sub = jsonSchemaToZod(subSchema);
      shape[key] = required.has(key) ? sub : sub.optional();
    }
    let obj: ZodTypeAny;
    const additional = schema.additionalProperties;
    if (additional === false) {
      obj = z.strictObject(shape);
    } else if (additional && typeof additional === 'object') {
      obj = z.object(shape).catchall(jsonSchemaToZod(additional as Schema));
    } else {
      // additionalProperties is true / unspecified — be permissive
      obj = z.object(shape).catchall(z.unknown());
    }
    return obj;
  }
  return applyStringConstraints(schema, buildScalarForType(type));
}

function buildSchemaUntyped(schema: Schema): ZodTypeAny {
  const enumZ = buildEnum(schema);
  if (enumZ) return enumZ;

  if (Array.isArray(schema.oneOf)) {
    const variants = (schema.oneOf as Schema[]).map((s) => jsonSchemaToZod(s));
    if (variants.length === 1) return variants[0];
    return z.union(variants as unknown as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]]);
  }

  if (Array.isArray(schema.anyOf)) {
    const variants = (schema.anyOf as Schema[]).map((s) => jsonSchemaToZod(s));
    if (variants.length === 1) return variants[0];
    return z.union(variants as unknown as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]]);
  }

  const types = asArray(schema.type as string | string[] | undefined);

  if (types.length === 0) {
    if (schema.properties || schema.additionalProperties !== undefined) {
      return buildForType(schema, 'object');
    }
    return z.unknown();
  }

  if (types.length === 1) {
    return buildForType(schema, types[0]);
  }

  // Multi-type union, e.g. ["string", "null"] or ["object", "null"].
  const variants = types.map((t) => buildForType(schema, t));
  return z.union(variants as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]]);
}

export function jsonSchemaToZod(schema: Schema): ZodTypeAny {
  if (!schema || typeof schema !== 'object') return z.unknown();
  return describeIfPresent(buildSchemaUntyped(schema), schema);
}
