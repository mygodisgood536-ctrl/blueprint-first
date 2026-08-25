import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  VERIFICATION_DIMENSIONS,
  assertElevenDimensions,
  dimensionIndex,
} from '../src/verification/dimensions.ts';
import { summarizeReport } from '../src/verification/verifier.ts';
import type { VerificationReport, VerificationFinding } from '../src/verification/verifier.ts';
import {
  sameActorIdentity,
  assertIndependentVerifier,
  certificationDecision,
} from '../src/verification/independence.ts';
import { MemoryEvidenceLog } from '../src/verification/evidence.ts';
import { SelfCertificationError } from '../src/core/errors.ts';

const producer = { kind: 'ai' as const, id: 'worker-1', modelId: 'model-a' };

function reportWith(findings: VerificationFinding[]): VerificationReport {
  return {
    artifactId: 'PAGE-0001',
    verifier: { kind: 'verifier', id: 'specialist-7' },
    findings,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
  };
}

describe('eleven verification dimensions', () => {
  it('contains exactly the architecture-defined dimensions', () => {
    const dims = assertElevenDimensions();
    assert.equal(dims.length, 11);
    for (const required of [
      'COUNT',
      'COVERAGE',
      'IDENTITY',
      'CORRECTNESS',
      'QUALITY',
      'TRACEABILITY',
      'DEPENDENCY_INTEGRITY',
      'DUPLICATION',
      'CONFLICTS',
      'CONSISTENCY',
      'EVIDENCE_OF_WORK',
    ]) {
      assert.ok(dims.includes(required as (typeof dims)[number]));
      assert.ok(dimensionIndex(required as (typeof dims)[number]) >= 0);
    }
  });
});

describe('report summarization', () => {
  it('counts verdicts and computes missing dimensions honestly', () => {
    const report = reportWith([
      { dimension: 'IDENTITY', verdict: 'pass', detail: 'ok' },
      { dimension: 'COUNT', verdict: 'fail', detail: 'expected 3 pages, found 2' },
      { dimension: 'QUALITY', verdict: 'inconclusive', detail: 'needs human eye' },
    ]);
    const summary = summarizeReport(report);
    assert.equal(summary.passed, 1);
    assert.equal(summary.failed, 1);
    assert.equal(summary.inconclusive, 1);
    assert.equal(summary.coversAllEleven, false);
    assert.equal(summary.hasBlockingFailure, true);
    assert.ok(summary.missingDimensions.length === 8);
    assert.ok(summary.missingDimensions.includes('TRACEABILITY'));
  });

  it('recognizes full coverage', () => {
    const findings = VERIFICATION_DIMENSIONS.map((dimension) => ({
      dimension,
      verdict: 'pass' as const,
      detail: 'ok',
    }));
    const summary = summarizeReport(reportWith(findings));
    assert.equal(summary.coversAllEleven, true);
    assert.equal(summary.missingDimensions.length, 0);
  });
});

describe('independence enforcement', () => {
  it('blocks the same origin from verifying its own work regardless of kind label', () => {
    assert.throws(
      () =>
        assertIndependentVerifier(
          producer,
          { kind: 'verifier', id: 'worker-1' }, // same id, relabeled
        ),
      SelfCertificationError,
    );
    // Different origins pass.
    assert.doesNotThrow(() => assertIndependentVerifier(producer, { kind: 'verifier', id: 'spec-9' }));
  });

  it('reports identical origins via sameActorIdentity', () => {
    assert.equal(sameActorIdentity(producer, { kind: 'ai', id: 'worker-1' }), true);
    assert.equal(sameActorIdentity(producer, { kind: 'ai', id: 'worker-2' }), false);
  });

  it('certification requires full coverage, no failures, and an independent verifier', () => {
    const partial = reportWith([
      { dimension: 'IDENTITY', verdict: 'pass', detail: 'ok' },
    ]);
    const partialDecision = certificationDecision(partial, producer);
    assert.equal(partialDecision.certifiable, false);
    assert.ok(partialDecision.reasons.some((r) => /eleven dimensions/.test(r)));

    const failingFull = reportWith(
      VERIFICATION_DIMENSIONS.map((dimension) => ({
        dimension,
        verdict: dimension === 'CORRECTNESS' ? ('fail' as const) : ('pass' as const),
        detail: 'x',
      })),
    );
    const failingDecision = certificationDecision(failingFull, producer);
    assert.equal(failingDecision.certifiable, false);
    assert.ok(failingDecision.reasons.some((r) => /failing finding/.test(r)));

    const goodFull = reportWith(
      VERIFICATION_DIMENSIONS.map((dimension) => ({
        dimension,
        verdict: 'pass' as const,
        detail: 'x',
      })),
    );
    assert.equal(certificationDecision(goodFull, producer).certifiable, true);

    // An 'inconclusive' dimension is NOT evidence: certification is refused
    // even when coverage is complete and nothing fails (bosses may still
    // ACCEPT such work; certification demands conclusive evidence).
    const inconclusiveFull = reportWith(
      VERIFICATION_DIMENSIONS.map((dimension) => ({
        dimension,
        verdict: (dimension === 'CORRECTNESS' ? 'inconclusive' : 'pass') as 'inconclusive' | 'pass',
        detail: 'x',
      })),
    );
    const inconclusiveDecision = certificationDecision(inconclusiveFull, producer);
    assert.equal(inconclusiveDecision.certifiable, false);
    assert.ok(inconclusiveDecision.reasons.some((r) => /inconclusive finding\(s\) \(CORRECTNESS\)/.test(r)));

    // Self-certification is refused even with a perfect report.
    const selfReport: VerificationReport = { ...goodFull, verifier: producer };
    const selfDecision = certificationDecision(selfReport, producer);
    assert.equal(selfDecision.certifiable, false);
  });
});

describe('evidence log', () => {
  it('assigns monotonic ids and validates artifact references', async () => {
    const log = new MemoryEvidenceLog();
    const first = await log.append({
      kind: 'test-run',
      summary: 'vitest run all green',
      artifactIds: ['PAGE-0001'],
      producer,
    });
    const second = await log.append({ kind: 'review', summary: 'manual review', producer });
    assert.match(first.id, /^EV-\d{6}$/);
    assert.notEqual(first.id, second.id);
    await log.append({ kind: 'metric', summary: 'bad ref', artifactIds: ['NOT-AN-ID'], producer })
      .then(() => assert.fail('expected throw'))
      .catch((error: unknown) => assert.ok(error instanceof Error));
    const forPage = await log.forArtifact('PAGE-0001');
    assert.equal(forPage.length, 1);
    assert.equal((await log.all()).length, 2);
  });
});
