/**
 * The artifact domain model: actors, provenance, and artifacts themselves.
 *
 * An artifact is any durable, traceable unit of product/engineering knowledge
 * (requirement, page, design, rule, API contract, ...). Its identity is stable
 * (see ids.ts); its truth lives in metadata + provenance: who created it,
 * which model produced it, what evidence backs it, and how its status changed
 * over time. Stores persist these objects verbatim.
 */

import { parseArtifactId } from './ids.ts';
import type { ArtifactType } from './ids.ts';
import { InvalidArtifactIdError } from './errors.ts';
import type { ArtifactStatus } from './status.ts';

/** Who/what acted on an artifact. AI actions record the producing model. */
export interface Actor {
  kind: 'human' | 'ai' | 'system' | 'verifier';
  id: string;
  /** Identifier of the AI model used, when kind === 'ai'. */
  modelId?: string;
}

export function describeActor(actor: Actor): string {
  return actor.modelId !== undefined
    ? `${actor.kind}:${actor.id}@${actor.modelId}`
    : `${actor.kind}:${actor.id}`;
}

export type ProvenanceAction =
  | 'created'
  | 'updated'
  | 'status-changed'
  | 'doc-gate'
  | 'verified'
  | 'approved'
  | 'rejected';

export interface ProvenanceEntry {
  at: string;
  action: ProvenanceAction;
  actor: Actor;
  note?: string;
  evidenceId?: string;
}

export interface Artifact {
  id: string;
  type: ArtifactType;
  projectId: string | null;
  title: string;
  description: string;
  status: ArtifactStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
  createdBy: Actor;
  dependencies: readonly string[];
  tags: readonly string[];
  attributes: Readonly<Record<string, unknown>>;
  provenance: readonly ProvenanceEntry[];
  /**
   * Discovery confidence score (spec §0.13): a number in [0,1] expressing how
   * strongly the discovery organization supports this artifact. Optional -
   * artifacts produced before Level 1b (and non-discovery stages until their
   * departments adopt scoring) may omit it. States/validations may inherit
   * their parent's score rather than carrying their own.
   */
  confidence?: number;
}

export interface CreateArtifactInput {
  id: string;
  type: ArtifactType;
  title: string;
  description?: string;
  projectId?: string;
  actor: Actor;
  at?: string;
  dependencies?: readonly string[];
  tags?: readonly string[];
  attributes?: Record<string, unknown>;
  /** Discovery confidence score in [0,1]; omitted when not yet scored. */
  confidence?: number;
}

export function createArtifact(input: CreateArtifactInput): Artifact {
  const parsed = parseArtifactId(input.id);
  if (parsed.type !== input.type) {
    throw new InvalidArtifactIdError(
      `ID "${input.id}" has type ${parsed.type} but artifact declares type ${input.type}.`,
    );
  }
  const title = input.title.trim();
  if (title.length === 0) {
    throw new InvalidArtifactIdError(`Artifact ${input.id} requires a non-empty title.`);
  }
  const deps = input.dependencies ?? [];
  if (deps.includes(input.id)) {
    throw new InvalidArtifactIdError(`Artifact ${input.id} cannot depend on itself.`);
  }
  if (
    input.confidence !== undefined &&
    (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1)
  ) {
    throw new InvalidArtifactIdError(
      `Artifact ${input.id} confidence must be a finite number in [0,1], got ${String(input.confidence)}.`,
    );
  }
  const at = input.at ?? new Date().toISOString();
  return Object.freeze({
    id: parsed.canonical,
    type: input.type,
    projectId: input.projectId ?? null,
    title,
    description: input.description?.trim() ?? '',
    status: 'DRAFT',
    version: 1,
    createdAt: at,
    updatedAt: at,
    createdBy: input.actor,
    dependencies: Object.freeze([...deps]),
    tags: Object.freeze([...(input.tags ?? [])]),
    attributes: Object.freeze({ ...(input.attributes ?? {}) }),
    provenance: Object.freeze([
      Object.freeze({ at, action: 'created', actor: input.actor }),
    ]),
    ...(input.confidence !== undefined ? { confidence: input.confidence } : {}),
  });
}

/** Pure helper: returns a new artifact with an appended provenance entry. */
export function withProvenance(
  artifact: Artifact,
  entry: ProvenanceEntry,
): Artifact {
  return Object.freeze({
    ...artifact,
    version: artifact.version + 1,
    updatedAt: entry.at,
    provenance: Object.freeze([...artifact.provenance, Object.freeze(entry)]),
  });
}
