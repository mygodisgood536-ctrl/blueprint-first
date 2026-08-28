/**
 * AI Engineering Guardian (Level 5, spec §5).
 *
 * The Guardian is a continuous root-cause-tracing watch. It takes a
 * runtime signal (a DriftItem from the Continuous Engineering Worker, a
 * TelemetryObservation, or a Safe Change proposal trail) and classifies
 * it as one of:
 *
 *   - KNOWN     — a root cause that has already been cataloged in
 *                 Engineering Memory (§5.5). The same fix has been
 *                 applied before; the platform applies the matching
 *                 remediation without spawning a new Self-Healing round.
 *   - RECURRING — the same root cause has been seen N times in the
 *                 Guardian's window, but no cataloged fix yet. The
 *                 platform escalates the recurrence to the Continuous
 *                 Engineering Boss for human review.
 *   - NOVEL     — a root cause that has never been cataloged. The
 *                 platform hands the signal to the Self-Healing System
 *                 for isolated-replica reproduction + candidate fix.
 *
 * Critically: the Guardian is structurally independent of the
 * Continuous Engineering Worker. It does NOT re-run the worker's claim;
 * it reads the signal (the DriftItem or the TelemetryObservation) and
 * re-derives its own root-cause hypothesis from the artifact ID +
 * dimension + kind. Two identical signals thus get the same
 * classification — deterministic, replay-safe.
 */
import { createHash } from 'node:crypto';
import type { Actor } from '../core/artifact.ts';
import type { DriftItem } from '../verification/live-engine.ts';
import type { TelemetryObservation } from '../telemetry/source.ts';
import type {
  GuardianClassification,
  GuardianWatch,
} from './types.ts';

const GUARDIAN: Actor = { kind: 'system', id: 'ai-engineering-guardian-01' };

/** Engineering Memory: a root-cause catalog consulted by the Guardian.
 *  Caller (e.g. the Learning Engine) extends this over time. */
export interface GuardianMemory {
  /** baseId + dimension + kind -> known root cause + remediation summary. */
  readonly known: ReadonlyMap<string, { rootCause: string; remediation: string }>;
}

export function emptyGuardianMemory(): GuardianMemory {
  return { known: new Map() };
}

/** Deterministic key under which a known root cause is cataloged. */
export function guardianKey(d: Pick<DriftItem, 'artifactId' | 'dimension' | 'kind'>): string {
  return `${d.artifactId}::${d.dimension}::${d.kind}`;
}

function hashHex(parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('\u0000')).digest('hex');
}

export interface GuardianInput {
  readonly signal:
    | { kind: 'drift'; drift: DriftItem }
    | { kind: 'telemetry'; observation: TelemetryObservation };
  /** Existing Guardian watch log on this run. Used to detect RECURRING. */
  readonly priorWatches: readonly GuardianWatch[];
  /** Engineering Memory (cataloged root causes). */
  readonly memory: GuardianMemory;
  /** RECURRING threshold — how many watches in the same window before a
   *  signal is escalated as RECURRING. Default 2 (i.e. seen twice). */
  readonly recurringThreshold?: number;
}

/** Classify a runtime signal. Pure: same inputs -> same output, no side
 *  effects. */
export function classifySignal(input: GuardianInput): GuardianWatch {
  const threshold = input.recurringThreshold ?? 2;
  const now = new Date().toISOString();
  const baseId = input.signal.kind === 'drift' ? input.signal.drift.artifactId : input.signal.observation.baseId;
  const dim = input.signal.kind === 'drift' ? input.signal.drift.dimension : 'CORRECTNESS';
  const kind = input.signal.kind === 'drift' ? input.signal.drift.kind : 'REGRESSED';

  const key = guardianKey({ artifactId: baseId, dimension: dim, kind });
  const known = input.memory.known.get(key);

  let classifiedAs: GuardianClassification;
  let rootCause: string;
  let relatedWatchIds: string[] = [];

  if (known !== undefined) {
    classifiedAs = 'KNOWN';
    rootCause = known.rootCause;
  } else {
    // Look at prior watches for the same baseId+dimension+kind to detect
    // RECURRING (novel-but-repeated). KNOWN watches are excluded because
    // they have already been cataloged and routed through the known-fix
    // path; only NOVEL watches count as recurrence candidates.
    relatedWatchIds = input.priorWatches
      .filter((w) => w.baseId === baseId && w.classifiedAs === 'NOVEL')
      .map((w) => w.watchId)
      .filter((id, idx, arr) => arr.indexOf(id) === idx)
      .sort();
    if (relatedWatchIds.length + 1 >= threshold) {
      classifiedAs = 'RECURRING';
      rootCause = relatedWatchIds.length === 0
        ? `recurring: ${key} (single watch; threshold = ${threshold})`
        : `recurring: ${key} (${relatedWatchIds.length + 1} occurrences in window)`;
    } else {
      classifiedAs = 'NOVEL';
      rootCause = 'novel';
    }
  }

  const evidenceHash = hashHex([
    baseId,
    dim,
    kind,
    input.signal.kind,
    classifiedAs,
    now,
  ]);
  const watchId = `WATCH-${evidenceHash.slice(0, 12)}`;
  return {
    watchId,
    baseId,
    classifiedAs,
    rootCause,
    relatedWatchIds,
    evidenceHash,
    watchedBy: GUARDIAN,
    watchedAt: now,
  };
}

/** Append a watch to a watch log. Pure: returns a new array. */
export function withAppendedWatch(
  watches: readonly GuardianWatch[],
  watch: GuardianWatch,
): GuardianWatch[] {
  return [...watches, watch];
}
