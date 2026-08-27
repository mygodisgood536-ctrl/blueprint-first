/**
 * Stable artifact identity.
 *
 * Every durable artifact in the platform carries an ID of the form:
 *
 *     TYPE-NNNN            e.g. PAGE-0042, FEAT-0007, API-0013
 *     TYPE-NNNN-PHASE      e.g. PAGE-0042-DESIGN, PAGE-0042-IMPL
 *
 * Phase suffixes express the production lineage required by the architecture:
 *
 *     PAGE-0042 -> PAGE-0042-DESIGN -> PAGE-0042-IMPL -> PAGE-0042-TEST
 *               -> PAGE-0042-DEPLOY  ->  PAGE-0042-OPS
 *
 * IDs are canonical: the numeric part is zero-padded to four digits (growing
 * beyond four only after 9999), phase suffixes must appear in canonical order,
 * and parsing rejects anything that is not byte-identical to its canonical
 * form. This module is pure: no clock, no I/O, no randomness - identical input
 * always yields identical results.
 */

import { InvalidArtifactIdError } from './errors.ts';

/**
 * Artifact classes established by the architecture. The set is closed on
 * purpose: adding a class is a deliberate schema decision, not a typo.
 */
export const ARTIFACT_TYPES = [
  'PROJECT', 'MODULE', 'FEATURE', 'WORKFLOW', 'PAGE', 'SECTION', 'CONTENT',
  'ACTION', 'STATE', 'VALIDATION', 'RULE', 'PERMISSION', 'API', 'ENTITY',
  'INTEGRATION', 'COMPONENT', 'TEST', 'BLUEPRINT', 'FINDING', 'RISK',
] as const;

export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

const TYPE_SET: ReadonlySet<string> = new Set(ARTIFACT_TYPES);

/** Production-lineage phases appended to a base artifact ID. */
export const ARTIFACT_PHASES = ['DESIGN', 'IMPL', 'TEST', 'DEPLOY', 'OPS', 'PERM'] as const;

export type ArtifactPhase = (typeof ARTIFACT_PHASES)[number];

const PHASE_SET: ReadonlySet<string> = new Set(ARTIFACT_PHASES);

/** The full lifecycle chain used when building a complete lineage. */
export const FULL_LIFECYCLE_PHASES: readonly ArtifactPhase[] = ARTIFACT_PHASES;

export interface ParsedArtifactId {
  readonly type: ArtifactType;
  readonly number: number;
  /** Phase suffixes in canonical order; empty for base artifacts. */
  readonly phases: readonly ArtifactPhase[];
  /** Canonical string form (identical to the parsed input). */
  readonly canonical: string;
}

function formatNumber(value: number): string {
  return String(value).padStart(4, '0');
}

function validatePhaseSequence(phases: readonly ArtifactPhase[]): void {
  let lastIndex = -1;
  for (const phase of phases) {
    const index = ARTIFACT_PHASES.indexOf(phase);
    if (index === -1) {
      throw new InvalidArtifactIdError(`Unknown artifact phase "${String(phase)}".`);
    }
    if (index <= lastIndex) {
      throw new InvalidArtifactIdError(
        `Phase "${phase}" is out of canonical order or repeated.`,
      );
    }
    lastIndex = index;
  }
}

export function formatArtifactId(
  type: ArtifactType,
  number: number,
  phases: readonly ArtifactPhase[] = [],
): string {
  if (!TYPE_SET.has(type)) {
    throw new InvalidArtifactIdError(`Unknown artifact type "${String(type)}".`);
  }
  if (!Number.isInteger(number) || number < 1) {
    throw new InvalidArtifactIdError(
      `Artifact number must be a positive integer, got ${String(number)}.`,
    );
  }
  validatePhaseSequence(phases);
  const suffix = phases.map((p) => `-${p}`).join('');
  return `${type}-${formatNumber(number)}${suffix}`;
}

export function parseArtifactId(raw: string): ParsedArtifactId {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new InvalidArtifactIdError('Artifact ID is empty.');
  }
  const parts = trimmed.split('-');
  const type = parts[0];
  const numberRaw = parts[1];
  if (parts.length < 2 || type === undefined || numberRaw === undefined) {
    throw new InvalidArtifactIdError(
      `Artifact ID "${trimmed}" must contain at least TYPE and NUMBER segments.`,
    );
  }
  if (!TYPE_SET.has(type)) {
    throw new InvalidArtifactIdError(
      `Unknown artifact type "${type}" in ID "${trimmed}". Known types: ${ARTIFACT_TYPES.join(', ')}.`,
    );
  }
  // Canonical numbers are >= 4 digits, zero-padded ("0042"); longer numbers
  // may not carry redundant leading zeros.
  if (!/^\d{4,}$/.test(numberRaw) || (numberRaw.length > 4 && numberRaw.startsWith('0'))) {
    throw new InvalidArtifactIdError(
      `Artifact number segment "${numberRaw}" in ID "${trimmed}" is not canonical (expected zero-padded 4+ digits).`,
    );
  }
  const number = Number.parseInt(numberRaw, 10);
  if (!Number.isInteger(number) || number < 1) {
    throw new InvalidArtifactIdError(`Artifact number in ID "${trimmed}" must be positive.`);
  }

  const phaseParts = parts.slice(2);
  for (const phase of phaseParts) {
    if (phase === undefined || !PHASE_SET.has(phase)) {
      throw new InvalidArtifactIdError(
        `Unknown artifact phase "${String(phase)}" in ID "${trimmed}". Known phases: ${ARTIFACT_PHASES.join(', ')}.`,
      );
    }
  }
  validatePhaseSequence(phaseParts as ArtifactPhase[]);

  const canonical = formatArtifactId(type as ArtifactType, number, phaseParts as ArtifactPhase[]);
  return { type: type as ArtifactType, number, phases: Object.freeze([...phaseParts]) as ArtifactPhase[], canonical };
}

/** True when the ID carries no phase suffix (i.e. it is a base artifact). */
export function isBaseArtifactId(raw: string): boolean {
  return parseArtifactId(raw).phases.length === 0;
}

/**
 * Strips all phase suffixes, returning the canonical base ID.
 * Example: "PAGE-0042-DESIGN" -> "PAGE-0042".
 */
export function baseOf(raw: string): string {
  const parsed = parseArtifactId(raw);
  return formatArtifactId(parsed.type, parsed.number);
}

/**
 * Builds the full production lineage for a base artifact:
 * [BASE, BASE-DESIGN, BASE-IMPL, BASE-TEST, BASE-DEPLOY, BASE-OPS, BASE-PERM].
 *
 * Accepts only a base ID (use baseOf() first for phased IDs).
 */
export function lineageChain(
  id: string,
  phases: readonly ArtifactPhase[] = FULL_LIFECYCLE_PHASES,
): string[] {
  const parsed = parseArtifactId(id);
  if (parsed.phases.length > 0) {
    throw new InvalidArtifactIdError(
      `lineageChain expects a base artifact ID, got phased ID "${parsed.canonical}". Use baseOf() first.`,
    );
  }
  validatePhaseSequence(phases);
  const chain = [parsed.canonical];
  for (const phase of phases) {
    chain.push(`${parsed.canonical}-${phase}`);
  }
  return chain;
}

