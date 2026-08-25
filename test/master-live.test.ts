import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MasterVerificationEngine } from '../src/verification/master-engine.ts';
import type { MasterVerificationInput } from '../src/verification/master-engine.ts';
import { LiveVerificationEngine } from '../src/verification/live-engine.ts';
import { SelfCertificationError } from '../src/core/errors.ts';
import { builtProject, createClosureVerifier, endorse } from './helpers/level2-fixture.ts';

type Services = Awaited<ReturnType<typeof builtProject>>['services'];

async function masterInput(): Promise<{
  services: Services;
  blueprintId: string;
  input: MasterVerificationInput;
}> {
  const { services, blueprintId, setIds } = await builtProject();
  const council = await endorse(services, blueprintId, [blueprintId]);
  const input: MasterVerificationInput = {
    artifactIds: setIds,
    artifactClass: 'blueprint',
    verifiers: [{ name: 'closure-verifier', verifier: createClosureVerifier() }],
    producerActors: [
      { kind: 'ai', id: 'understanding-worker-01' },
      { kind: 'ai', id: 'structural-worker-01' },
      { kind: 'ai', id: 'design-worker-01' },
      { kind: 'ai', id: 'build-worker-01' },
    ],
    deliberation: council,
  };
  return { services, blueprintId, input };
}

describe('master verification engine (Level 2)', () => {
  it('audits the full closure set with rollup, coverage and council resolution', async () => {
    const { services, input } = await masterInput();
    const master = await new MasterVerificationEngine(services).verifyArtifactSet(input);

    assert.equal(master.masterPassed, true);
    assert.equal(master.subjectCount, input.artifactIds.length);
    assert.equal(Object.keys(master.reports).length, input.artifactIds.length);
    assert.equal(master.rollup.length, 11);
    assert.deepEqual(master.unresolvedInconclusive, []);
    assert.equal(master.coverageAudit.complete, true);
    const correctness = master.rollup.find((r) => r.dimension === 'CORRECTNESS');
    assert.equal(correctness?.pass, input.artifactIds.length);
    const endorsedFinding = Object.values(master.reports)[0]?.findings.find(
      (f) => f.dimension === 'CORRECTNESS',
    );
    assert.match(endorsedFinding?.detail ?? '', /Council endorsement/);
  });

  it('stays honest without a deliberation: judgment dims stay inconclusive', async () => {
    const { services, blueprintId, setIds } = await builtProject();
    const master = await new MasterVerificationEngine(services).verifyArtifactSet({
      artifactIds: setIds,
      artifactClass: 'blueprint',
      verifiers: [{ name: 'closure-verifier', verifier: createClosureVerifier() }],
      producerActors: [{ kind: 'ai', id: 'build-worker-01' }],
    });
    const correctness = master.rollup.find((r) => r.dimension === 'CORRECTNESS');
    assert.ok((correctness?.inconclusive ?? 0) > 0);
    assert.equal(
      master.reports[blueprintId]?.findings.some(
        (f) => f.dimension === 'CORRECTNESS' && f.verdict === 'inconclusive',
      ),
      true,
    );
    // The class profile allows judgment-dimension inconclusives, so the audit
    // itself is complete - but certification separately demands endorsement.
    assert.equal(master.coverageAudit.complete, true);
  });

  it('refuses to audit when a verifier shares a producer origin', async () => {
    const { services, blueprintId, setIds } = await builtProject();
    void blueprintId;
    await assert.rejects(
      () =>
        new MasterVerificationEngine(services).verifyArtifactSet({
          artifactIds: setIds,
          artifactClass: 'blueprint',
          verifiers: [
            {
              name: 'impostor',
              verifier: {
                actor: { kind: 'verifier', id: 'structural-worker-01' },
                verify: async ({ artifact }) => ({
                  artifactId: artifact.id,
                  verifier: { kind: 'verifier', id: 'structural-worker-01' },
                  findings: [],
                  startedAt: new Date().toISOString(),
                  finishedAt: new Date().toISOString(),
                }),
              },
            },
          ],
          producerActors: [{ kind: 'ai', id: 'structural-worker-01' }],
        }),
      SelfCertificationError,
    );
  });

  it('turns council objections into blocking fails', async () => {
    const { services, blueprintId, setIds } = await builtProject();
    const endorsed = await endorse(services, blueprintId, [blueprintId]);
    const master = await new MasterVerificationEngine(services).verifyArtifactSet({
      artifactIds: setIds,
      artifactClass: 'blueprint',
      verifiers: [{ name: 'closure-verifier', verifier: createClosureVerifier() }],
      producerActors: [{ kind: 'ai', id: 'build-worker-01' }],
      deliberation: {
        ...endorsed,
        verdict: 'objected',
        objections: [
          {
            seatId: 'qa-engineer',
            severity: 'objection' as const,
            statement: 'No error path for empty states.',
            artifactIds: [blueprintId],
          },
        ],
      },
    });
    assert.equal(master.masterPassed, false);
    assert.ok(master.blockingFails >= 3);
    assert.match(
      master.reports[blueprintId]?.findings.find((f) => f.verdict === 'fail')?.detail ?? '',
      /Council objection/,
    );
  });
});

describe('live verification engine (Level 2)', () => {
  async function priorRun(): Promise<{
    services: Services;
    input: MasterVerificationInput;
    prior: Awaited<ReturnType<MasterVerificationEngine['verifyArtifactSet']>>;
  }> {
    const { services, blueprintId, setIds } = await builtProject();
    const council = await endorse(services, blueprintId, [blueprintId]);
    const input: MasterVerificationInput = {
      artifactIds: setIds,
      artifactClass: 'blueprint',
      verifiers: [{ name: 'closure-verifier', verifier: createClosureVerifier() }],
      producerActors: [
        { kind: 'ai', id: 'understanding-worker-01' },
        { kind: 'ai', id: 'structural-worker-01' },
        { kind: 'ai', id: 'design-worker-01' },
        { kind: 'ai', id: 'build-worker-01' },
      ],
      deliberation: council,
    };
    const prior = await new MasterVerificationEngine(services).verifyArtifactSet(input);
    assert.equal(prior.masterPassed, true);
    return { services, input, prior };
  }

  it('detects REGRESSED drift after stored state is tampered', async () => {
    const { services, input, prior } = await priorRun();
    const feature = await services.store.require('FEATURE-0001');
    await services.store.update(feature.id, feature.version, (draft) => ({
      ...draft,
      status: 'DRAFT',
    }));

    const live = await new LiveVerificationEngine(services).reverify(input, prior);
    assert.equal(live.stable, false);
    assert.ok(live.drift.some((d) => d.artifactId === 'FEATURE-0001' && d.kind === 'REGRESSED'));
    assert.equal(live.masterNow.masterPassed, false);
  });

  it('reports stability when nothing changed', async () => {
    const { services, input, prior } = await priorRun();
    const live = await new LiveVerificationEngine(services).reverify(input, prior);
    assert.equal(live.stable, true);
    assert.equal(live.drift.length, 0);
    assert.equal(live.masterNow.masterPassed, true);
  });
});