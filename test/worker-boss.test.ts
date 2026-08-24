import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runWorkerBossFlow } from '../src/orchestration/worker-boss.ts';
import { SelfCertificationError } from '../src/core/errors.ts';

const task = { title: 'Build the thing' };

describe('worker-boss flow', () => {
  it('runs produce -> self -> specialist -> boss in order on acceptance', async () => {
    const calls: string[] = [];
    const outcome = await runWorkerBossFlow<{ name: string }>({
      task,
      worker: {
        actor: { kind: 'ai', id: 'w1' },
        produce: async () => {
          calls.push('produce');
          return { name: 'draft' };
        },
      },
      selfVerifier: {
        actor: { kind: 'ai', id: 'w1' },
        selfVerify: async () => {
          calls.push('self');
          return { passed: true, notes: 'ok' };
        },
      },
      specialistVerifier: {
        actor: { kind: 'verifier', id: 's1' },
        verify: async () => {
          calls.push('specialist');
          return {
            artifactId: 'PAGE-0001',
            verifier: { kind: 'verifier', id: 's1' },
            findings: [{ dimension: 'IDENTITY', verdict: 'pass', detail: 'ok' }],
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
          };
        },
      },
      boss: {
        actor: { kind: 'verifier', id: 'boss-1' },
        decide: async () => {
          calls.push('boss');
          return { decision: 'accepted', rationale: 'fine' };
        },
      },
    });
    assert.deepEqual(calls, ['produce', 'self', 'specialist', 'boss']);
    assert.equal(outcome.accepted, true);
    assert.deepEqual(
      outcome.steps.map((s) => s.step),
      ['produce', 'self-verify', 'specialist-verify', 'boss-decide'],
    );
    assert.equal(outcome.verdictCounts.pass, 1);
  });

  it('refuses a specialist who is the same origin as the worker - before any work runs', async () => {
    let produced = false;
    await assert.rejects(
      () =>
        runWorkerBossFlow({
          task,
          worker: {
            actor: { kind: 'ai', id: 'same-guy' },
            produce: async () => {
              produced = true;
              return {};
            },
          },
          specialistVerifier: {
            actor: { kind: 'verifier', id: 'same-guy' }, // relabeled, same origin
            verify: async () => {
              throw new Error('should never be reached');
            },
          },
          boss: {
            actor: { kind: 'verifier', id: 'boss-9' },
            decide: async () => ({ decision: 'accepted', rationale: '' }),
          },
        }),
      SelfCertificationError,
    );
    assert.equal(produced, false); // fail fast BEFORE production
  });

  it('refuses a boss who is the same origin as the worker', async () => {
    await assert.rejects(
      () =>
        runWorkerBossFlow({
          task,
          worker: { actor: { kind: 'ai', id: 'w2' }, produce: async () => ({}) },
          specialistVerifier: {
            actor: { kind: 'verifier', id: 's2' },
            verify: async () => ({
              artifactId: 'X-0001',
              verifier: { kind: 'verifier', id: 's2' },
              findings: [],
              startedAt: '',
              finishedAt: '',
            }),
          },
          boss: { actor: { kind: 'verifier', id: 'w2' }, decide: async () => ({ decision: 'accepted', rationale: '' }) },
        }),
      SelfCertificationError,
    );
  });

  it('surfaces rejections with the boss rationale and verdict counts', async () => {
    const outcome = await runWorkerBossFlow({
      task,
      worker: { actor: { kind: 'ai', id: 'w3' }, produce: async () => ({}) },
      specialistVerifier: {
        actor: { kind: 'verifier', id: 's3' },
        verify: async () => ({
          artifactId: 'PAGE-0002',
          verifier: { kind: 'verifier', id: 's3' },
          findings: [
            { dimension: 'CORRECTNESS', verdict: 'fail', detail: 'wrong behavior' },
            { dimension: 'COUNT', verdict: 'pass', detail: 'count ok' },
          ],
          startedAt: '',
          finishedAt: '',
        }),
      },
      boss: {
        actor: { kind: 'verifier', id: 'boss-3' },
        decide: async (_t, _d, _s, report) => ({
          decision: report.findings.some((f) => f.verdict === 'fail') ? 'rejected' : 'accepted',
          rationale: 'blocking failure present',
        }),
      },
    });
    assert.equal(outcome.accepted, false);
    assert.equal(outcome.decision?.rationale, 'blocking failure present');
    assert.equal(outcome.verdictCounts.fail, 1);
  });
});
