/**
 * AI Acceptance Testing Department (Level 3, Stage 3) - orchestrator.
 *
 * Production and judgment stay separate jobs end to end:
 *
 *   Test Worker corps : executes the mechanically derived acceptance suite
 *                       (scope from the certified Master Product Inventory).
 *   Test Boss         : independently reconstructs required coverage AND
 *                       expected outcomes from stored baselines; any delta
 *                       rejects.
 *   Test Auditor      : re-executes a deterministic sample and compares
 *                       results byte-for-byte.
 *
 * Only after both judgments confirm does the run materialize -TEST lineage
 * artifacts and advance the Definition-of-Complete machine: designs to
 * DESIGN-VERIFIED and implementations to TEST-VERIFIED. The walker refuses
 * to fabricate CERTIFIED, so un-certified projects halt honestly instead.
 */

import type { CoreServices } from '../core/services.ts';
import { deriveExpectedCoverage } from './coverage.ts';
import type { CoverageExpectation } from './coverage.ts';
import { executeCoverage } from './execute.ts';
import type { ExecutedCheck } from './execute.ts';
import { runTestBoss } from './boss.ts';
import { runTestAuditor } from './auditor.ts';
import { materializeTestRun } from './materialize.ts';
import { advanceDocPath } from '../core/doc.ts';

export interface JudgmentDecision {
  readonly verdict: 'accepted' | 'rejected' | 'confirmed';
  readonly rationale: string;
}

export interface TestDepartmentResult {
  readonly status: 'passed' | 'failed';
  readonly expected: readonly CoverageExpectation[];
  readonly executed: readonly ExecutedCheck[];
  readonly failedChecks: readonly string[];
  readonly boss: JudgmentDecision;
  readonly auditor: JudgmentDecision;
  readonly reportId?: string;
  readonly testIds: readonly string[];
  /** -IMPL artifacts that legitimately reached DoC TEST-VERIFIED. */
  readonly advancedToTestVerified: readonly string[];
  /** Artifacts whose walk stopped (e.g. pending real CERTIFIED). */
  readonly docHalts: readonly { id: string; haltedAt: string }[];
  readonly evidenceId?: string;
}

function failure(
  expected: readonly CoverageExpectation[],
  executed: readonly ExecutedCheck[],
  failedChecks: readonly string[],
  boss: JudgmentDecision,
  auditorRationale: string,
): TestDepartmentResult {
  return {
    status: 'failed',
    expected,
    executed,
    failedChecks,
    boss,
    auditor: { verdict: 'rejected', rationale: auditorRationale },
    testIds: [],
    advancedToTestVerified: [],
    docHalts: [],
  };
}

export async function runTestDepartment(
  services: CoreServices,
  projectId: string,
  options: { sampleSize?: number } = {},
): Promise<TestDepartmentResult> {
  const expected = await deriveExpectedCoverage(services, projectId);
  const executed = await executeCoverage(services, expected);
  const failedChecks = executed.filter((c) => !c.passed).map((c) => c.baseId);

  if (expected.length === 0) {
    return failure(
      expected,
      executed,
      ['(no certified FEATURE/PAGE items found)'],
      { verdict: 'rejected', rationale: 'The certified inventory yields an empty coverage matrix.' },
      'Not run: no coverage to execute.',
    );
  }
  if (failedChecks.length > 0) {
    return failure(
      expected,
      executed,
      failedChecks,
      {
        verdict: 'rejected',
        rationale: `The corps reported failures: [${failedChecks.join(', ')}]. Nothing advances without passing evidence.`,
      },
      'Not run: the suite did not pass.',
    );
  }

  const boss = await runTestBoss(services, projectId, executed);
  if (boss.verdict === 'rejected') {
    return failure(expected, executed, [], boss, 'Not run: the Test Boss rejected.');
  }

  const sampleSize = options.sampleSize ?? Math.max(1, Math.ceil(executed.length / 2));
  const auditor = await runTestAuditor(services, executed, sampleSize);
  if (auditor.verdict === 'rejected') {
    return failure(expected, executed, [], boss, auditor.rationale);
  }

  const mat = await materializeTestRun(services, executed, {
    projectId,
    bossRationale: boss.rationale,
    auditorRationale: auditor.rationale,
  });

  // Governed Definition-of-Complete advancement on the real phase artifacts.
  const advancedToTestVerified: string[] = [];
  const docHalts: { id: string; haltedAt: string }[] = [];
  for (const exp of expected) {
    const designId = `${exp.baseId}-DESIGN`;
    if ((await services.store.get(designId)) !== null) {
      const walk = await advanceDocPath(services.store, designId, 'DESIGN-VERIFIED');
      if (!walk.reachedTarget && walk.haltedAt !== undefined) {
        docHalts.push({ id: designId, haltedAt: walk.haltedAt });
      }
    }
    if (exp.kind === 'functional') {
      const implId = `${exp.baseId}-IMPL`;
      if ((await services.store.get(implId)) !== null) {
        const walk = await advanceDocPath(services.store, implId, 'TEST-VERIFIED');
        if (walk.reachedTarget) advancedToTestVerified.push(implId);
        else if (walk.haltedAt !== undefined) docHalts.push({ id: implId, haltedAt: walk.haltedAt });
      }
    }
  }

  const evidence = await services.evidence.append({
    kind: 'test-run',
    summary:
      `Acceptance suite: ${executed.length}/${executed.length} checks passed; ` +
      `boss accepted (${boss.rationale}); auditor confirmed ${auditor.sampledIds.length} sample(s).`,
    artifactIds: [mat.reportId, ...advancedToTestVerified],
    producer: { kind: 'verifier', id: 'test-boss-01' },
  });

  return {
    status: 'passed',
    expected,
    executed,
    failedChecks: [],
    boss,
    auditor,
    reportId: mat.reportId,
    testIds: mat.testIds,
    advancedToTestVerified,
    docHalts,
    evidenceId: evidence.id,
  };
}
