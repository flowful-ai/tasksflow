import { z } from 'zod';
import type { ToolJsonType, ToolParameterSchema } from '../../domain/index.js';

export type JsonValue = string | number | boolean | null | JsonValue[] | JsonRecord;
export interface JsonRecord {
  [key: string]: JsonValue | undefined;
}

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(jsonValueSchema), z.record(jsonValueSchema)])
);

function stringSchema(schema: ToolParameterSchema): z.ZodType<JsonValue> {
  if (schema.enum && schema.enum.length > 0) {
    const [first, ...rest] = schema.enum;
    if (first !== undefined) {
      return z.enum([first, ...rest]);
    }
  }
  let result = schema.format === 'uuid' ? z.string().uuid() : z.string();
  if (schema.minLength !== undefined) result = result.min(schema.minLength);
  if (schema.maxLength !== undefined) result = result.max(schema.maxLength);
  return result;
}

function numberSchema(schema: ToolParameterSchema, integer: boolean): z.ZodType<JsonValue> {
  let result = integer ? z.number().int() : z.number();
  if (schema.minimum !== undefined) result = result.min(schema.minimum);
  if (schema.maximum !== undefined) result = result.max(schema.maximum);
  return result;
}

function objectSchema(schema: ToolParameterSchema): z.ZodType<JsonValue> {
  const shape: Record<string, z.ZodType<JsonValue | undefined>> = {};
  const required = new Set(schema.required ?? []);
  for (const [key, value] of Object.entries(schema.properties ?? {})) {
    const mapped = jsonSchemaToZod(value);
    shape[key] = required.has(key) ? mapped : mapped.optional();
  }
  const base = z.object(shape);
  return schema.additionalProperties === false ? base.strict() : base.passthrough();
}

function singleTypeSchema(type: ToolJsonType, schema: ToolParameterSchema): z.ZodType<JsonValue> {
  switch (type) {
    case 'string':
      return stringSchema(schema);
    case 'number':
      return numberSchema(schema, false);
    case 'integer':
      return numberSchema(schema, true);
    case 'boolean':
      return z.boolean();
    case 'null':
      return z.null();
    case 'array': {
      let result = z.array(schema.items ? jsonSchemaToZod(schema.items) : jsonValueSchema);
      if (schema.minItems !== undefined) result = result.min(schema.minItems);
      if (schema.maxItems !== undefined) result = result.max(schema.maxItems);
      return result;
    }
    case 'object':
      return objectSchema(schema);
  }
}

/**
 * Converts the JSON Schema subset used by AGENT_TOOLS into a Zod validator, so
 * every tool call is checked against exactly the schema advertised to clients.
 */
export function jsonSchemaToZod(schema: ToolParameterSchema): z.ZodType<JsonValue> {
  const { type } = schema;
  if (type === undefined) {
    return jsonValueSchema;
  }
  if (!Array.isArray(type)) {
    return singleTypeSchema(type, schema);
  }
  const members = type.map((member) => singleTypeSchema(member, schema));
  const [first, second, ...rest] = members;
  if (!first) {
    return jsonValueSchema;
  }
  return second ? z.union([first, second, ...rest]) : first;
}

export function isJsonRecord(value: JsonValue | undefined): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Readable, model-friendly rendering of a Zod error. */
export function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 8)
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : 'arguments';
      if (issue.code === z.ZodIssueCode.unrecognized_keys) {
        return `${path}: unknown parameter(s) ${issue.keys.join(', ')}`;
      }
      return `${path}: ${issue.message}`;
    })
    .join('; ');
}
