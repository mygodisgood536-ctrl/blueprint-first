/**
 * §5.1 — Safe Change Intelligence: Impact Analysis (Level 5, spec §5.1).
 *
 * The impact analysis is the platform's "what changes, what is affected"
 * gate that every candidate change passes through before the Specialist
 * Verifier / Continuous Engineering Boss / Independent Audit chain.
 *
 * Inputs:
 *   - A CandidateChange (from the Guardian, the Self-Healing System, the
 *     Evolution Review, or a human/user request).
 *   - The graph, from which we build the Dependency Map.
 *
 * Output: an `ImpactAnalysis` whose `declared` set is what the change-maker
 * explicitly named (the change's `baseId` and the optional `drift.artifactId`
 * / `observation.baseId` if present), and whose `discovered` set is what
 * the Dependency Map surfaced that the change-maker did NOT name.
 *
 * The two are unioned into `affected`, which is the canonical set every
 * downstream engine (Specialist Verifier, Continuous Engineering Boss,
 * Independent Audit) consults. The Boss's regression protection (§5.2) is
 * what makes the discovered set a real load-bearing concept: the Boss
 * re-derives the expected post-change state for every artifact in
 * `affected`, not just `declared`, so a change that passes its own
 * intended test cases but silently regresses an unrelated, previously
 * CERTIFIED COMPLETE artifact is caught here, by ID, before it is allowed
 * to merge.
 */
import { createHash } from 'node:crypto';
import type { Actor } from '../core/artifact.ts';
import type { KnowledgeGraph } from '../core/graph.ts';
import { downstreamArtifacts, allRelatedArtifacts } from './dependency-map.ts';
import type { CandidateChange, ImpactAnalysis } from './types.ts';

const ANALYST: Actor = { kind: 'ai', id: 'safe-change-impact-analyst-01' };

/** Pure derivation: given a change and the graph, compute the analysis.
 *  This function does NOT mutate the graph or the artifact; it returns
 *  an `ImpactAnalysis` record that the orchestrator persists. */
export function runImpactAnalysis(
  graph: KnowledgeGraph,
  change: CandidateChange,
): ImpactAnalysis {
  // The declared set is what the change explicitly references.
  const declared: string[] = [change.baseId];
  if (change.drift?.artifactId !== undefined && change.drift.artifactId !== change.baseId) {
    declared.push(change.drift.artifactId);
  }
  if (change.observation?.baseId !== undefined && change.observation.baseId !== change.baseId) {
    declared.push(change.observation.baseId);
  }
  const declaredSorted = [...new Set(declared)].sort();

  // The discovered set is what the Dependency Map surfaces that the
  // change-maker did NOT name. The §5.2 contract: a change to X risks
  // breaking things that consume X. We pull the downstream of every
  // declared node and union them, then subtract declared.
  const allRelated = new Set<string>();
  for (const id of declaredSorted) {
    for (const down of downstreamArtifacts(graph, id)) {
      allRelated.add(down);
    }
  }
  const discovered: string[] = [];
  for (const id of allRelated) {
    if (!declaredSorted.includes(id)) discovered.push(id);
  }
  discovered.sort();

  const affected: string[] = [...new Set([...declaredSorted, ...discovered])].sort();
  const analysisHash = createHash('sha256').update(
    JSON.stringify({
      changeId: change.changeId,
      declared: declaredSorted,
      discovered,
      affected,
    }),
  ).digest('hex');
  const analysisId = `IMPACT-${analysisHash.slice(0, 12)}`;
  return {
    analysisId,
    changeId: change.changeId,
    analyzedBy: ANALYST,
    analyzedAt: new Date().toISOString(),
    declared: declaredSorted,
    discovered,
    affected,
    analysisHash,
    rationale: discovered.length === 0
      ? `Change to ${change.baseId} affects only the declared scope (${declaredSorted.length} artifact(s)); no downstream surprises found.`
      : `Change to ${change.baseId} affects ${declaredSorted.length} declared + ${discovered.length} downstream artifact(s) the change-maker did not name; the Boss will verify all ${affected.length} before merge (§5.2).`,
  };
}

/** Convenience for callers that want both directions (a UI inspecting a
 *  change can show the user the full related set, with the discovered
 *  subset highlighted). */
export function allArtifactsAffectedBy(
  graph: KnowledgeGraph,
  change: CandidateChange,
): readonly string[] {
  const set = new Set<string>([change.baseId]);
  if (change.drift?.artifactId !== undefined) set.add(change.drift.artifactId);
  if (change.observation?.baseId !== undefined) set.add(change.observation.baseId);
  for (const id of set) {
    for (const r of allRelatedArtifacts(graph, id)) set.add(r);
  }
  return [...set].sort();
}
