/**
 * Continuous Learning Engine (Level 5, spec §5, cross-cutting).
 *
 * The Learning Engine studies what happened across the full lifecycle of
 * every completed project and feeds these findings back into the AI
 * Router's standing routing decisions and the worker's standing
 * coverage templates. It does NOT modify any worker or boss; it produces
 * `LearningEntry` records that the orchestrator (or an external
 * operator) consults when configuring the next project.
 *
 * Critically: every LearningEntry is anchored to its source artifact
 * IDs, so a future lesson can be attributed back to the exact event
 * that produced it. Nothing is fabricated.
 */
import { createHash } from 'node:crypto';
import type { Actor } from '../core/artifact.ts';
import type { LearningEntry } from './types.ts';

const LEARNER: Actor = { kind: 'ai', id: 'continuous-learning-engine-01' };

function entryHash(title: string, body: string, source: readonly string[], at: string): string {
  return createHash('sha256').update(JSON.stringify({ title, body, source, at })).digest('hex');
}

export interface LearnInput {
  readonly stage: LearningEntry['stage'];
  readonly title: string;
  readonly body: string;
  readonly sourceArtifactIds: readonly string[];
}

/** Records a lesson. Pure: returns a new entry; the caller decides
 *  whether to persist it (e.g. as a FINDING artifact). */
export function recordLesson(input: LearnInput, at: string = new Date().toISOString()): LearningEntry {
  const source = [...input.sourceArtifactIds].sort();
  const hash = entryHash(input.title, input.body, source, at);
  return {
    entryId: `LESSON-${hash.slice(0, 12)}`,
    stage: input.stage,
    title: input.title,
    body: input.body,
    sourceArtifactIds: source,
    entryHash: hash,
    recordedBy: LEARNER,
    recordedAt: at,
  };
}

/** Returns a list of standing routing recommendations derived from a
 *  list of lessons. This is the deterministic stand-in for the AI
 *  Router's "feed lessons back" behavior — a real implementation would
 *  call into a learned model; this one summarizes by stage and emits
 *  one recommendation per stage that has any lessons, sorted by
 *  entryId for determinism. */
export function routingRecommendations(lessons: readonly LearningEntry[]): readonly {
  readonly stage: LearningEntry['stage'];
  readonly lessonCount: number;
  readonly firstLesson: LearningEntry;
}[] {
  const byStage = new Map<LearningEntry['stage'], LearningEntry[]>();
  for (const lesson of lessons) {
    const list = byStage.get(lesson.stage) ?? [];
    list.push(lesson);
    byStage.set(lesson.stage, list);
  }
  const out: { stage: LearningEntry['stage']; lessonCount: number; firstLesson: LearningEntry }[] = [];
  for (const [stage, list] of byStage.entries()) {
    const sorted = [...list].sort((a, b) => a.entryId.localeCompare(b.entryId));
    const first = sorted[0];
    if (first === undefined) continue;
    out.push({ stage, lessonCount: list.length, firstLesson: first });
  }
  return out.sort((a, b) => a.stage.localeCompare(b.stage));
}
