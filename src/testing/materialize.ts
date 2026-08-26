/**
 * Test materialization: persist the Acceptance Testing Department's results
 * as lineage artifacts with exact phase suffixes.
 *
 *   PAGE-0001-IMPL    -> PAGE-0001-TEST     (DERIVED_FROM edge)
 *   FEATURE-0001-IMPL -> FEATURE-0001-TEST  (DERIVED_FROM edge)
 *   TEST-n (acceptance report) aggregates every -TEST (CONTAINS).
 *
 * Each -TEST artifact records the deterministic requirement, observation and
 * sha256 evidence hash behind its verdict, plus the Boss/Auditor rationales
 * - so the judgment chain is inspectable from the artifact itself.
 */

import type { CoreServices } from '../core/services.ts';
import type { Actor } from '../core/artifact.ts';
import { createArtifact } from '../core/artifact.ts';
import { syncArtifactToGraph } from '../core/graph.ts';
import { recordStatusChange } from '../core/store.ts';
import type { ExecutedCheck } from './execute.ts';

const WORKER: Actor = { kind: 'ai', id: 'test-worker-01' };
const VERIFIER: Actor = { kind: 'verifier', id: 'test-specialist-01' };

export interface TestRunMeta {
  readonly projectId: string;
  readonly bossRationale: string;
  readonly auditorRationale: string;
}

export interface TestMaterializationResult {
  readonly reportId: string;
  readonly testIds: readonly string[];
}

/** Dependency of a -TEST artifact: the implementation (functional) or the design (render). */
function dependencyOf(check: ExecutedCheck): string {
  return check.kind === 'functional' ? `${check.baseId}-IMPL` : `${check.baseId}-DESIGN`;
}

export async function materializeTestRun(
  services: CoreServices,
  executed: readonly ExecutedCheck[],
  meta: TestRunMeta,
): Promise<TestMaterializationResult> {
  const at = new Date().toISOString();
  const testIds: string[] = [];

  for (const check of executed) {
    const base = await services.store.require(check.baseId);
    const depId = dependencyOf(check);
    await services.store.require(depId); // fails loudly if lineage is broken
    const id = `${check.baseId}-TEST`;
    const artifact = createArtifact({
      id,
      type: base.type,
      title: `Acceptance test: ${base.title}`,
      description: check.observed,
      projectId: meta.projectId,
      actor: WORKER,
      at,
      dependencies: [depId],
      attributes: {
        checkKind: check.kind,
        requirement: check.requirement,
        observed: check.observed,
        passed: check.passed,
        evidenceHash: check.evidenceHash,
        bossRationale: meta.bossRationale,
        auditorRationale: meta.auditorRationale,
      },
    });
    await services.store.append(artifact);
    syncArtifactToGraph(services.graph, artifact);
    services.graph.link(id, 'DERIVED_FROM', depId);
    // Independent confirmation: worker submits, the test specialist verifies.
    await recordStatusChange(services.store, id, 'IN_REVIEW', WORKER, {
      note: 'Acceptance result submitted for verification.',
    });
    await recordStatusChange(services.store, id, 'VERIFIED', VERIFIER, {
      note: 'Confirmed by the Test Auditor re-execution.',
    });
    testIds.push(id);
  }

  const passedCount = executed.filter((c) => c.passed).length;
  const reportId = services.allocator.nextId('TEST');
  const report = createArtifact({
    id: reportId,
    type: 'TEST',
    title: `Acceptance test report for ${meta.projectId}`,
    description:
      `${passedCount}/${executed.length} acceptance checks passed under ` +
      `boss reconstruction and auditor re-execution.`,
    projectId: meta.projectId,
    actor: WORKER,
    at,
    dependencies: [],
    attributes: {
      totalChecks: executed.length,
      passedChecks: passedCount,
      bossRationale: meta.bossRationale,
      auditorRationale: meta.auditorRationale,
      testIds: [...testIds],
    },
  });
  await services.store.append(report);
  syncArtifactToGraph(services.graph, report);
  for (const id of testIds) {
    services.graph.link(reportId, 'CONTAINS', id);
  }

  return { reportId, testIds };
}
