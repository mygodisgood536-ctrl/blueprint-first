/** Small structural helpers shared by discovery parsing/validation. */

export type Obj = Record<string, unknown>;

export function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function isStrArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

/** Appends a problem when item[field] is not a non-empty string. */
export function needString(
  item: Obj,
  field: string,
  label: string,
  problems: string[],
): void {
  const v = item[field];
  if (typeof v !== 'string' || v.trim() === '') {
    problems.push(`${label}.${field}: required non-empty string.`);
  }
}
