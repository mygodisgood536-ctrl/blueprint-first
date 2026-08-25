/**
 * Parsing + normalization for the Discovery Department (Level 1b).
 *
 * Cluster A (Understanding) has its own small schema. Cluster B (Structural)
 * reuses the ENTIRE Level-1a validation machinery by combining the two cluster
 * responses into the single RawDiscoveryResult shape and running the existing
 * structural parser + semantic normalizer - no duplicated validators, and
 * every referential check (features→modules, pages→modules,
 * validations→actions, apis→entities) applies across clusters exactly as the
 * architecture requires.
 */

import { isObj, needString } from '../parse-util.ts';
import { parseDiscoveryResult } from '../parse.ts';
import { normalizeDiscovery } from '../normalize.ts';
import type { NormalizedInventory } from '../normalize.ts';
import type {
  RawStructuralResult,
  RawUnderstandingResult,
} from './types.ts';
import { DiscoveryParseError } from '../errors.ts';

/** Validates Cluster A's response on its own minimal schema. */
export function parseUnderstanding(value: unknown): RawUnderstandingResult {
  const problems: string[] = [];
  if (!isObj(value)) {
    throw new DiscoveryParseError(['Understanding response is not a JSON object.']);
  }
  if (!isObj(value['product'])) {
    problems.push('product: missing or not an object.');
  } else {
    const p = value['product'];
    needString(p, 'name', 'product', problems);
    needString(p, 'summary', 'product', problems);
  }
  if (value['domainProfile'] !== undefined && typeof value['domainProfile'] !== 'string') {
    problems.push('domainProfile: must be a string when present.');
  }
  validateSelfCheck(value, problems);

  // Structural collections must NOT appear in the understanding response:
  // Cluster A decides what the product is; enumeration is Cluster B's job.
  for (const field of [
    'modules', 'features', 'workflows', 'pages', 'rules',
    'permissions', 'entities', 'apis', 'integrations',
  ] as const) {
    if (value[field] !== undefined) {
      problems.push(`${field}: Cluster A must not produce structural inventories.`);
    }
  }

  if (problems.length > 0) throw new DiscoveryParseError(problems);
  return value as unknown as RawUnderstandingResult;
}

/** Shared §0.14 self-check block validation (both clusters carry it). */
export function validateSelfCheck(value: Record<string, unknown>, problems: string[]): void {
  const sc = value['selfCheck'];
  if (sc === undefined) return;
  if (!isObj(sc)) {
    problems.push('selfCheck: must be an object when present.');
    return;
  }
  const u = sc['uncertainties'];
  if (u === undefined) return;
  if (!Array.isArray(u) || !u.every((x) => typeof x === 'string')) {
    problems.push('selfCheck.uncertainties: must be an array of strings when present.');
  }
}

/**
 * Combines both cluster responses into the complete Level-1a schema and runs
 * the full structural-parse + semantic-normalization pipeline over it.
 * Throws DiscoveryParseError / DiscoveryValidationError exactly like the
 * single-pass engine - callers attribute failures to Cluster B, since every
 * enumerated collection and cross-reference lives on the B side.
 */
export function normalizeDepartmentInventory(
  understanding: RawUnderstandingResult,
  structural: RawStructuralResult,
): NormalizedInventory {
  return normalizeDiscovery(
    parseDiscoveryResult({
      product: understanding.product,
      modules: structural.modules ?? [],
      features: structural.features ?? [],
      workflows: structural.workflows ?? [],
      pages: structural.pages ?? [],
      rules: structural.rules ?? [],
      permissions: structural.permissions ?? [],
      entities: structural.entities ?? [],
      apis: structural.apis ?? [],
      integrations: structural.integrations ?? [],
    }),
  );
}