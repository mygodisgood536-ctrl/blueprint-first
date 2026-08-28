/**
 * §T.4 — Certification History Immutability (Level 5, spec §T.4).
 *
 * A previously certified baseline is never silently overwritten. When a
 * certified artifact changes — by a Change/Reopening Request (§2.4), a
 * production drift correction (§4.5), or a Stage 5 change (§5.1) — the
 * artifact's ID does not move to a new certification; it accumulates one.
 * The previous certified state, the reason for change, the affected
 * artifacts identified by the impact analysis, the impact analysis itself,
 * the revised artifact, the verification evidence, and the new
 * certification are all retained as a permanent sequence, never replaced
 * or deleted.
 *
 * This module:
 *   - Defines a stable `change_history` attribute shape (a readonly array
 *     of `ChangeHistoryEntry` records).
 *   - Provides pure functions to APPEND an entry (never replace).
 *   - Provides a query function `historyAt(artifact, asOf)` that returns
 *     the latest entry whose `recordedAt <= asOf` — i.e. "what was
 *     certified true of this artifact at any earlier point, and why it
 *     changed" (§T.4).
 *
 * Storage: the array is kept on the artifact's `attributes.change_history`.
 * Storing it on the artifact (rather than in a separate log) means a
 * snapshot of the artifact at version N already contains the complete
 * history up to N — replay-safe without an external log lookup.
 */
import { createHash } from 'node:crypto';
import type { Artifact } from '../core/artifact.ts';
import type { ChangeHistoryEntry } from './types.ts';

const HISTORY_KEY = 'change_history';

function hashString(parts: readonly string[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

function entryBodyHash(entry: Omit<ChangeHistoryEntry, 'entryHash' | 'entryId'>): string {
  return createHash('sha256').update(
    JSON.stringify({
      recordedAt: entry.recordedAt,
      reason: entry.reason,
      affectedArtifacts: entry.affectedArtifacts,
      impactAnalysisHash: entry.impactAnalysisHash,
      revisedArtifactHash: entry.revisedArtifactHash,
      verificationEvidenceHash: entry.verificationEvidenceHash,
      certifiedBy: entry.certifiedBy,
    }),
  ).digest('hex');
}

/** Returns the current change_history of an artifact, or [] if none. */
export function getChangeHistory(artifact: Artifact): readonly ChangeHistoryEntry[] {
  const raw = artifact.attributes?.[HISTORY_KEY];
  if (!Array.isArray(raw)) return [];
  // The array is stored as plain JSON; structurally we trust it because
  // the only way to mutate it is via `appendChangeHistory` (which builds
  // a fresh, validated entry). Read-side validation is intentionally
  // lenient — the L5 spec says "retain every state that preceded it",
  // not "re-validate every read".
  return raw as readonly ChangeHistoryEntry[];
}

/** Builds a fresh `change_history` entry from the given inputs. Pure: does
 *  not read or write any artifact. */
export function buildChangeHistoryEntry(input: {
  readonly reason: string;
  readonly affectedArtifacts: readonly string[];
  readonly impactAnalysisHash: string;
  readonly revisedArtifactHash: string;
  readonly verificationEvidenceHash: string;
  readonly certifiedBy: ChangeHistoryEntry['certifiedBy'];
  readonly at?: string;
}): ChangeHistoryEntry {
  const recordedAt = input.at ?? new Date().toISOString();
  const body: Omit<ChangeHistoryEntry, 'entryHash' | 'entryId'> = {
    recordedAt,
    reason: input.reason,
    affectedArtifacts: [...input.affectedArtifacts].sort(),
    impactAnalysisHash: input.impactAnalysisHash,
    revisedArtifactHash: input.revisedArtifactHash,
    verificationEvidenceHash: input.verificationEvidenceHash,
    certifiedBy: input.certifiedBy,
  };
  const entryHash = entryBodyHash(body);
  const entryId = `CHANGE-HISTORY-${hashString([entryHash]).slice(0, 12)}`;
  return { entryId, ...body, entryHash };
}

/** Returns a NEW attribute map with the entry appended to the existing
 *  change_history. Never mutates the input. */
export function withAppendedChangeHistory(
  artifact: Artifact,
  entry: ChangeHistoryEntry,
): Record<string, unknown> {
  const current = getChangeHistory(artifact);
  // Defensive check: an entry with the same entryId is rejected.
  if (current.some((e) => e.entryId === entry.entryId)) {
    throw new Error(
      `change_history entry ${entry.entryId} already exists for artifact ${artifact.id}. ` +
        'Append-only: duplicate entryId refused.',
    );
  }
  return {
    ...artifact.attributes,
    [HISTORY_KEY]: [...current, entry],
  };
}

/** Returns the latest entry whose `recordedAt <= asOf`, or undefined if
 *  none exists. This is §T.4's "what was certified true of this artifact
 *  at any earlier point" query. */
export function historyAt(
  artifact: Artifact,
  asOf: string,
): ChangeHistoryEntry | undefined {
  const entries = getChangeHistory(artifact);
  let chosen: ChangeHistoryEntry | undefined;
  for (const entry of entries) {
    if (entry.recordedAt <= asOf) {
      if (chosen === undefined || entry.recordedAt > chosen.recordedAt) {
        chosen = entry;
      }
    }
  }
  return chosen;
}
