/**
 * Structural parsing of a discovery response (a JS value from JSON.parse)
 * into RawDiscoveryResult. Collects ALL problems before failing so callers
 * see everything wrong at once.
 */

import type { Obj } from './parse-util.ts';
import { isObj, isStrArray, needString } from './parse-util.ts';
import { collectPages } from './parse-pages.ts';
import type { RawDiscoveryResult } from './types.ts';
import { DiscoveryParseError } from './errors.ts';

const API_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE']);
const ENTITY_TYPES = new Set(['string', 'number', 'boolean', 'date']);
const INTEGRATION_DIRECTIONS = new Set(['inbound', 'outbound']);

export function parseDiscoveryResult(value: unknown): RawDiscoveryResult {
  const problems: string[] = [];
  if (!isObj(value)) {
    throw new DiscoveryParseError(['Response is not a JSON object.']);
  }

  // --- product ---
  let product: RawDiscoveryResult['product'] | undefined;
  if (!isObj(value['product'])) {
    problems.push('product: missing or not an object.');
  } else {
    const p = value['product'];
    needString(p, 'name', 'product', problems);
    needString(p, 'summary', 'product', problems);
    if (problems.length === 0) {
      product = { name: p['name'] as string, summary: p['summary'] as string };
    }
  }

  /** Validates a flat collection of objects with the given field checks. */
  function collection(
    field: string,
    checkItem: (item: Obj, label: string) => void,
  ): void {
    const raw = value[field];
    if (raw === undefined) return; // optional collections default to empty
    if (!Array.isArray(raw)) {
      problems.push(`${field}: must be an array when present.`);
      return;
    }
    raw.forEach((item, i) => {
      const label = `${field}[${i}]`;
      if (!isObj(item)) {
        problems.push(`${label}: must be an object.`);
        return;
      }
      checkItem(item, label);
    });
  }

  collection('modules', (m, l) => {
    needString(m, 'key', l, problems);
    needString(m, 'title', l, problems);
    needString(m, 'purpose', l, problems);
  });
  collection('features', (f, l) => {
    needString(f, 'key', l, problems);
    needString(f, 'moduleKey', l, problems);
    needString(f, 'title', l, problems);
    needString(f, 'description', l, problems);
  });
  collection('workflows', (w, l) => {
    needString(w, 'key', l, problems);
    needString(w, 'title', l, problems);
    if (!isStrArray(w['steps'])) problems.push(`${l}.steps: required array of strings.`);
  });

  collectPages(value, problems);

  collection('rules', (r, l) => {
    needString(r, 'key', l, problems);
    needString(r, 'statement', l, problems);
  });
  collection('permissions', (p, l) => {
    needString(p, 'key', l, problems);
    needString(p, 'resource', l, problems);
    if (!isStrArray(p['roles']) || p['roles'].length === 0) {
      problems.push(`${l}.roles: required non-empty array of strings.`);
    }
  });
  collection('entities', (e, l) => {
    needString(e, 'key', l, problems);
    needString(e, 'name', l, problems);
    if (!Array.isArray(e['fields']) || e['fields'].length === 0) {
      problems.push(`${l}.fields: required non-empty array.`);
      return;
    }
    e['fields'].forEach((f, j) => {
      const fl = `${l}.fields[${j}]`;
      if (!isObj(f)) return void problems.push(`${fl}: must be an object.`);
      needString(f, 'name', fl, problems);
      if (typeof f['type'] !== 'string' || !ENTITY_TYPES.has(f['type'])) {
        problems.push(`${fl}.type: must be one of string|number|boolean|date.`);
      }
      if (typeof f['required'] !== 'boolean') {
        problems.push(`${fl}.required: must be a boolean.`);
      }
    });
  });
  collection('apis', (a, l) => {
    needString(a, 'key', l, problems);
    if (typeof a['method'] !== 'string' || !API_METHODS.has(a['method'])) {
      problems.push(`${l}.method: must be one of GET|POST|PUT|DELETE.`);
    }
    needString(a, 'path', l, problems);
    if (typeof a['path'] === 'string' && !a['path'].startsWith('/')) {
      problems.push(`${l}.path: must start with "/".`);
    }
    needString(a, 'purpose', l, problems);
  });
  collection('integrations', (g, l) => {
    needString(g, 'key', l, problems);
    needString(g, 'name', l, problems);
    if (
      typeof g['direction'] !== 'string' ||
      !INTEGRATION_DIRECTIONS.has(g['direction'])
    ) {
      problems.push(`${l}.direction: must be "inbound" or "outbound".`);
    }
    needString(g, 'purpose', l, problems);
  });

  if (problems.length > 0) throw new DiscoveryParseError(problems);

  return {
    product: product as RawDiscoveryResult['product'],
    modules: (value['modules'] ?? []) as RawDiscoveryResult['modules'],
    features: (value['features'] ?? []) as RawDiscoveryResult['features'],
    workflows: (value['workflows'] ?? []) as RawDiscoveryResult['workflows'],
    pages: collectPages(value, []),
    rules: (value['rules'] ?? []) as RawDiscoveryResult['rules'],
    permissions: (value['permissions'] ?? []) as RawDiscoveryResult['permissions'],
    entities: (value['entities'] ?? []) as RawDiscoveryResult['entities'],
    apis: (value['apis'] ?? []) as RawDiscoveryResult['apis'],
    integrations: (value['integrations'] ?? []) as RawDiscoveryResult['integrations'],
  };
}
