import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MasterVerificationEngine } from '../src/verification/master-engine.ts';
import type { MasterVerificationResult } from '../src/verification/master-engine.ts';
import { requirementsTraceability } from '../src/traceability/trace.ts';
import type { RequirementsTraceabilityMatrix } from '../src/traceability/trace.ts';
import {
  certifyBlueprintCompleteness,
  computeBlueprintConfidence,
} from '../src/design/certification.ts';
import { approveBlueprint } from '../src/design/approval.ts';
import { docStateOf } from '../src/core/doc.ts';
import type { CoreServices } from '../src/core/services.ts';
import { putNewArtifact } from '../src/core/store.ts';
import { DiscoveryDepartment } from '../src/discovery/department/engine.ts';
import { AiDesignStudio } from '../src/design/studio.ts';
import { AiBuildStudio } from '../src/build/studio.ts';
import { builtProject, createClosureVerifier, endorse, BRIEF } from './helpers/level2-fixture.ts';
import { makeServices } from './helpers/test-services.ts';

const BRIEF_PROJECT = 'PROJECT-0001';

interface Fixture {
  readonly services: CoreServices;
  readonly blueprintId: string;
  readonly master: MasterVerificationResult;
  readonly council: Awaited<ReturnType<typeof endorse>>;
  readonly trace: RequirementsTraceabilityMatrix;
}

/** Full chain (department -> design -> [approval] -> [build]) + cert inputs. */
async function fixture(
  options: { readonly approve?: boolean; readonly build?: boolean } = {},
): Promise<Fixture> {
  const approve = options.approve ?? true;
  const doBuild = options.build ?? true;
  const services = makeServices();

  const department = await new DiscoveryDepartment(services).discover(BRIEF);
  assert.equal(department.status, 'accepted');
  assert.ok(department.baseline !== undefined);
  const design = await new AiDesignStudio(services).designFromBaseline(department.baseline);
  assert.equal(design.status, 'accepted');
  assert.ok(design.blueprintId !== undefined);
  if (approve) {
    const approval = await approveBlueprint(services, design.blueprintId);
    assert.equal(approval.approved, true);
  }
  let buildIds: readonly string[] = [];
  if (doBuild && approve) {
    const build = await new AiBuildStudio(services).buildFromBlueprint(design.blueprintId);
    assert.equal(build.status, 'accepted');
    buildIds = build.artifactIds;
  }

  const idSet = new Set<string>([
    design.blueprintId,
    ...design.artifactIds,
    ...buildIds,
  ]);
  // The council deliberates BEFORE the master audit so judgment dimensions
  // arrive already resolved - exactly how an integrator composes Level 2.
  const council = await endorse(services, design.blueprintId, [design.blueprintId]);
  const master = await new MasterVerificationEngine(services).verifyArtifactSet({
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
    services.store,
    services.graph,
    services.evidence,
    department.baseline.projectId,
  );
  return { services, blueprintId: design.blueprintId, master, council, trace };
}

describe('blueprint completeness certification (Level 2)', () => {
  it('certifies a fully verified chain and stamps CERTIFIED across the closure', async () => {
    const { services, blueprintId, master, council, trace } = await fixture();
    assert.equal(trace.complete, true); // precondition sanity

    const result = await certifyBlueprintCompleteness(services, {
      blueprintId,
      master,
      council,
      trace,
    });
    assert.deepEqual(result.reasons, []);
    assert.equal(result.certified, true);

    // Governed CERTIFIED stamps across the closure.
    const blueprint = await services.store.require(blueprintId);
    assert.equal(docStateOf(blueprint), 'CERTIFIED');
    assert.equal(docStateOf(await services.store.require('FEATURE-0001')), 'CERTIFIED');
    assert.equal(docStateOf(await services.store.require('FEATURE-0001-IMPL')), 'CERTIFIED');
    assert.ok(result.stampedArtifactIds.includes('PAGE-0001'));

    // Certification is evidence-backed and recorded on the blueprint.
    assert.ok(result.evidenceId !== undefined);
    assert.equal(blueprint.attributes['certificationEvidenceId'], result.evidenceId);
  });

  it('reports explainable per-dimension confidence distinct from certification', async () => {
    const { services, blueprintId, master, council, trace } = await fixture();
    const confidence = computeBlueprintConfidence(services, {
      blueprintId,
      master,
      council,
      trace,
    });

    assert.ok(
      confidence.aggregateScore !== null &&
        confidence.aggregateScore > 0 &&
        confidence.aggregateScore <= 1,
    );
    const byId = new Map(confidence.dimensions.map((d) => [d.id, d]));
    assert.equal(byId.get('requirements-completeness')?.score, 1);

    // Seat-derived dimensions cite the seat's OWN evidence record.
    const uxSeat = council.seats.find((s) => s.seatId === 'ux-designer');
    const ux = byId.get('ui-ux-consistency');
    assert.equal(ux?.score, 1);
    assert.ok(uxSeat?.evidenceId !== undefined);
    assert.ok(
      (ux?.basis ?? '').includes(uxSeat.evidenceId),
      'ux basis must cite the ux seat evidence id',
    );

    // Unproduced subjects are null with an explicit basis - never faked.
    assert.equal(byId.get('accessibility')?.score, null);
    assert.match(byId.get('accessibility')?.basis ?? '', /Level 2 scope|later level/);
    assert.match(confidence.explanation, /excluded rather than faked/);
  });

  it('refuses when the approval gate no longer holds', async () => {
    const { services, blueprintId, master, council, trace } = await fixture({ approve: false });
    const result = await certifyBlueprintCompleteness(services, {
      blueprintId,
      master,
      council,
      trace,
    });
    assert.equal(result.certified, false);
    assert.ok(
      result.reasons.some((r) => /Approval gate|only APPROVED blueprints/.test(r)),
      `reasons: ${result.reasons.join(' | ')}`,
    );
  });

  it('refuses on a council objection even with perfect mechanics', async () => {
    const { services, blueprintId, master, council, trace } = await fixture();
    const objected = {
      ...council,
      verdict: 'objected' as const,
      objections: [
        {
          seatId: 'qa-engineer',
          severity: 'objection' as const,
          statement: 'No error path is specified for empty states.',
          artifactIds: [blueprintId],
        },
      ],
    };
    const result = await certifyBlueprintCompleteness(services, {
      blueprintId,
      master,
      council: objected,
      trace,
    });
    assert.equal(result.certified, false);
    assert.match(result.reasons.join(' '), /Council verdict is "objected"/);
  });

  it('rejects a deliberation about a different subject', async () => {
    const { services, blueprintId, master, council, trace } = await fixture();
    const result = await certifyBlueprintCompleteness(services, {
      blueprintId,
      master,
      council: { ...council, subject: 'BLUEPRINT-9999' },
      trace,
    });
    assert.equal(result.certified, false);
    assert.match(result.reasons.join(' '), /does not match/);
  });

  it('detects invented scope as traceability incompleteness', async () => {
    const { services, blueprintId, master, council, trace } = await fixture();
    // An invented page design with no discovery base and no implementation.
    const orphanId = `${services.allocator.nextId('PAGE')}-DESIGN`;
    await putNewArtifact(services.store, {
      id: orphanId,
      type: 'PAGE',
      title: 'Invented page design',
      projectId: BRIEF_PROJECT,
      actor: { kind: 'ai', id: 'design-worker-01' },
    });
    const freshTrace = await requirementsTraceability(
      services.store,
      services.graph,
      services.evidence,
      BRIEF_PROJECT,
    );
    assert.equal(freshTrace.complete, false);
    assert.ok(freshTrace.orphanedArtifacts.includes(orphanId));

    const result = await certifyBlueprintCompleteness(services, {
      blueprintId,
      master,
      council,
      trace: freshTrace,
    });
    void trace;
    assert.equal(result.certified, false);
    assert.match(result.reasons.join(' '), /Traceability incomplete/);
  });

  it('blocks when a closure artifact sits below BOSS-VERIFIED', async () => {
    const { services, blueprintId, master, council, trace } = await fixture();
    const design = await services.store.require('FEATURE-0002-DESIGN');
    await services.store.update(design.id, design.version, (draft) => ({
      ...draft,
      status: 'DRAFT',
    }));
    const result = await certifyBlueprintCompleteness(services, {
      blueprintId,
      master,
      council,
      trace,
    });
    assert.equal(result.certified, false);
    assert.ok(result.reasons.some((r) => /below BOSS-VERIFIED/.test(r)));
  });

  it('certification is impossible while required evidence is missing', async () => {
    // A chain without build: implementation links are missing entirely.
    const { services, blueprintId, master, council, trace } = await fixture({ build: false });
    assert.equal(trace.complete, false);
    const result = await certifyBlueprintCompleteness(services, {
      blueprintId,
      master,
      council,
      trace,
    });
    assert.equal(result.certified, false);
    assert.ok(result.reasons.some((r) => /Traceability incomplete/.test(r)));
  });
});