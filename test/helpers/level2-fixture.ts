/**
 * Shared Level-2 test fixtures: a complete built project (department ->
 * design -> approval -> build) plus the closure verifier and master/council
 * helpers the certification and live-engine suites compose.
 */

import assert from 'node:assert/strict';
import { DiscoveryDepartment } from '../../src/discovery/department/engine.ts';
import { AiDesignStudio } from '../../src/design/studio.ts';
import { approveBlueprint } from '../../src/design/approval.ts';
import { AiBuildStudio } from '../../src/build/studio.ts';
import type { CoreServices } from '../../src/core/services.ts';
import { createClosureVerifier } from '../../src/verification/closure-verifier.ts';
import { ReasoningCouncil } from '../../src/council/council.ts';
import type { CouncilDeliberation } from '../../src/council/council.ts';
import { makeServices } from './test-services.ts';
import type { VerificationFinding } from '../../src/verification/verifier.ts';

export { createClosureVerifier };

export const BRIEF = {
  name: 'TeamTask',
  vision: 'A lightweight task tracker that small teams can adopt in minutes.',
  targetUsers: ['small teams'],
};

export interface BuiltProject {
  readonly services: ReturnType<typeof makeServices>;
  readonly blueprintId: string;
  readonly setIds: readonly string[];
}

/** Runs the full Level-1a/1b chain and returns the built project + audit set. */
export async function builtProject(): Promise<BuiltProject> {
  const services = makeServices();
  const department = await new DiscoveryDepartment(services).discover(BRIEF);
  if (department.status !== 'accepted' || department.baseline === undefined) {
    throw new Error(`fixture department failed: ${department.status}`);
  }
  const design = await new AiDesignStudio(services).designFromBaseline(department.baseline);
  if (design.status !== 'accepted' || design.blueprintId === undefined) {
    throw new Error(`fixture design failed: ${design.status}`);
  }
  const approval = await approveBlueprint(services, design.blueprintId);
  if (!approval.approved) throw new Error('fixture approval failed');
  const build = await new AiBuildStudio(services).buildFromBlueprint(design.blueprintId);
  if (build.status !== 'accepted') throw new Error(`fixture build failed: ${build.status}`);

  const setIdSet = new Set<string>([
    design.blueprintId,
    ...build.artifactIds,
    ...design.artifactIds,
    ...department.artifactIds,
  ]);
  return {
    services,
    blueprintId: design.blueprintId,
    setIds: [...setIdSet].sort(),
  };
}

/**
 * A genuine per-artifact closure verifier for the master engine: mechanical
 * checks against STORED state (dependencies resolve, phased artifacts carry
 * their DERIVED_FROM edge, statuses are post-verification, evidence exists).
 */
// createClosureVerifier lives in src/verification/closure-verifier.ts (production)
export async function endorse(
  services: CoreServices,
  subject: string,
  artifactIds: readonly string[],
): Promise<CouncilDeliberation> {
  return new ReasoningCouncil(services).deliberate({
    subject,
    question: 'Is this blueprint complete and internally consistent?',
    contextSummary: 'The full discovery/design/build chain is stored and verified.',
    artifactIds,
  });
}

export function assertNoFails(report: { findings: readonly VerificationFinding[] }): void {
  assert.equal(report.findings.some((f) => f.verdict === 'fail'), false);
}