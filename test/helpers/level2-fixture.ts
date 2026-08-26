/**
 * Shared Level-2 test fixtures: a complete built -> (department ->
 * design -> approval -> build) plus the closure verifier and master/council
 * helpers the certification and live-engine suites compose.
 *
 * Also provides `buildLevel2Fixture` for Level 3 suites: a built project plus
 * the discovery baseline surfaced as `ctx.discovery` so downstream stages can
 * read the certified inventory and project id without re-deriving it.
 */
import assert from 'node:assert/strict';
import { DiscoveryDepartment } from '../../src/discovery/department/engine.ts';
import { AiDesignStudio } from '../../src/design/studio.ts';
import { approveBlueprint } from '../../src/design/approval.ts';
import { AiBuildStudio } from '../../src/build/studio.ts';
import { MasterVerificationEngine } from '../../src/verification/master-engine.ts';
import { requirementsTraceability } from '../../src/traceability/trace.ts';
import { certifyBlueprintCompleteness } from '../../src/design/certification.ts';
import type { CoreServices } from '../../src/core/services.ts';
import type { DiscoveryBaseline } from '../../src/discovery/materialize.ts';
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

export interface Level2FixtureContext {
  readonly services: ReturnType<typeof makeServices>;
  readonly discovery: DiscoveryBaseline;
  readonly blueprintId: string;
  readonly cleanup: () => Promise<void>;
}

export async function buildLevel2Fixture(): Promise<Level2FixtureContext> {
  const services = makeServices();
  const department = await new DiscoveryDepartment(services).discover(BRIEF);
  if (department.status !== 'accepted' || department.baseline === undefined) {
    throw new Error(`fixture department failed: ${department.status}`);
  }
  const baseline = department.baseline;
  const design = await new AiDesignStudio(services).designFromBaseline(baseline);
  if (design.status !== 'accepted' || design.blueprintId === undefined) {
    throw new Error(`fixture design failed: ${design.status}`);
  }
  const approval = await approveBlueprint(services, design.blueprintId);
  if (!approval.approved) throw new Error('fixture approval failed');
  const build = await new AiBuildStudio(services).buildFromBlueprint(design.blueprintId);
  if (build.status !== 'accepted') throw new Error(`fixture build failed: ${build.status}`);

  return {
    services,
    discovery: baseline,
    blueprintId: design.blueprintId,
    cleanup: async () => {},
  };
}

export interface CertifiedFixtureContext {
  readonly services: ReturnType<typeof makeServices>;
  readonly discovery: DiscoveryBaseline;
  readonly blueprintId: string;
  readonly certification: { readonly certified: boolean; readonly stampedArtifactIds: readonly string[] };
  readonly cleanup: () => Promise<void>;
}

/**
 * Builds AND certifies the project exactly as the demo does (council ->
 * master audit -> traceability -> Level-2 certification). The certification
 * engine stamps CERTIFIED across the design/implementation closure, which is
 * the precondition the Acceptance Testing Department needs before it may
 * advance artifacts to DESIGN-VERIFIED / TEST-VERIFIED (the DoC walker refuses
 * to fabricate CERTIFIED on its own).
 */
export async function certifiedLevel2Fixture(): Promise<CertifiedFixtureContext> {
  const built = await buildLevel2Fixture();

  const idSet = new Set<string>([built.blueprintId]);
  for (const a of await built.services.store.list({ projectId: built.discovery.projectId })) {
    if (/-DESIGN$/.test(a.id) || /-IMPL$/.test(a.id)) idSet.add(a.id);
  }

  const council = await new ReasoningCouncil(built.services).deliberate({
    subject: built.blueprintId,
    question: 'Is this blueprint complete and internally consistent?',
    contextSummary: 'The full discovery/design/build chain is stored and verified.',
    artifactIds: [built.blueprintId],
  });
  const master = await new MasterVerificationEngine(built.services).verifyArtifactSet({
    artifactIds: [...idSet],
    artifactClass: 'blueprint',
    verifiers: [{ name: 'closure-verifier', verifier: createClosureVerifier() }],
    producerActors: [
      { kind: 'ai', id: 'understanding-worker-01' },
      { kind: 'ai', id: 'structural-worker-01' },
      { kind: 'ai', id: 'design-worker-01' },
      { kind: 'ai', id: 'build-worker-01' },
    ],
    deliberation: council,
  });
  const trace = await requirementsTraceability(
    built.services.store,
    built.services.graph,
    built.services.evidence,
    built.discovery.projectId,
  );
  const certification = await certifyBlueprintCompleteness(built.services, {
    blueprintId: built.blueprintId,
    master,
    council,
    trace,
  });
  if (!certification.certified) {
    throw new Error(
      `certified fixture certification refused: ${certification.reasons.join('; ')}`,
    );
  }
  return {
    services: built.services,
    discovery: built.discovery,
    blueprintId: built.blueprintId,
    certification,
    cleanup: built.cleanup,
  };
}

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