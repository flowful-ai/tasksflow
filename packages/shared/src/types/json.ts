import { z } from 'zod';

/** A JSON-serialisable value (what a jsonb column or a webhook body can hold). */
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

/** Zod schema for JsonValue (finite numbers only, like isJsonValue). */
export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ])
);

/** Zod schema for JsonObject (a JSON object, never a primitive or an array). */
export const JsonObjectSchema: z.ZodType<JsonObject> = z.record(z.string(), JsonValueSchema);

export function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Runtime guard for values read from jsonb columns (typed `unknown` by drizzle). */
export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return true;
    case 'number':
      return Number.isFinite(value);
    case 'object':
      if (Array.isArray(value)) return value.every(isJsonValue);
      return Object.values(value).every(isJsonValue);
    default:
      return false;
  }
}

/** Narrow a jsonb value to JsonValue, mapping anything else to null. */
export function toJsonValue(value: unknown): JsonValue {
  return isJsonValue(value) ? value : null;
}

/** Narrow a jsonb value to a JsonObject, mapping anything else to {}. */
export function toJsonObject(value: unknown): JsonObject {
  const json = toJsonValue(value);
  return isJsonObject(json) ? json : {};
}
