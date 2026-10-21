/** KSC Runtime Value Types */

/**
 * KSC runtime value union.
 * Primitives + KscObject + KscArray.
 *
 * Design: typeTag and proto on KscObject are null for now.
 * When classes are introduced, typeTag holds the class name
 * and proto enables prototype chain lookup.
 */
export type Value =
  | number
  | string
  | boolean
  | null
  | KscObject
  | KscArray;

/** Object value with extensible type tag and prototype chain */
export interface KscObject {
  readonly __ksc_type: 'object';
  fields: Map<string, Value>;
  /** Class name (e.g. "Player"). null until class support is added. */
  typeTag: string | null;
  /** Prototype chain for method/property lookup. null until class support. */
  proto: KscObject | null;
}

/** Array value */
export interface KscArray {
  readonly __ksc_type: 'array';
  elements: Value[];
}

// ---- Type guards ----

export function isKscObject(v: Value): v is KscObject {
  return v !== null && typeof v === 'object' && '__ksc_type' in v && v.__ksc_type === 'object';
}

export function isKscArray(v: Value): v is KscArray {
  return v !== null && typeof v === 'object' && '__ksc_type' in v && v.__ksc_type === 'array';
}

// ---- Factory functions ----

export function createKscObject(
  fields?: Record<string, Value>,
  typeTag?: string | null,
  proto?: KscObject | null,
): KscObject {
  const obj: KscObject = {
    __ksc_type: 'object',
    fields: new Map(),
    typeTag: typeTag ?? null,
    proto: proto ?? null,
  };
  if (fields) {
    for (const [k, v] of Object.entries(fields)) {
      obj.fields.set(k, v);
    }
  }
  return obj;
}

export function createKscArray(elements?: Value[]): KscArray {
  return {
    __ksc_type: 'array',
    elements: elements ?? [],
  };
}
