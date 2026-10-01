import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateChangeReopenRequest } from '../src/change/reopening.ts';
import { KnowledgeGraph } from '../src/core/graph.ts';
import { DESIGN_BOSS } from '../src/design/studio.ts';

function graphWithChain(): KnowledgeGraph {
  const graph = new KnowledgeGraph();
  graph.addNode('PAGE-0001');
  graph.addNode('PAGE-0001-IMPL');
  graph.addNode('PAGE-0001-TEST');
  graph.link('PAGE-0001', 'DEPENDS_ON', 'PAGE-0001-IMPL');
  graph.link('PAGE-0001-IMPL', 'DEPENDS_ON', 'PAGE-0001-TEST');
  return graph;
}

describe('§2.4 Change / Reopening gate', () => {
  const buildWorker = { kind: 'ai' as const, id: 'build-worker-01' };

  it('admits a producer’s request and computes the Dependency-Map affected set', () => {
    const graph = graphWithChain();
    const decision = evaluateChangeReopenRequest(graph, {
      requestId: 'CR-1',
      discoveredBy: buildWorker,
      namedArtifacts: ['PAGE-0001'],
      reason: 'Build discovered a missing success path against the certified baseline.',
    });
    assert.equal(decision.verdict, 'ACCEPTED_FOR_RE_EVALUATION');
    assert.deepEqual(decision.declared, ['PAGE-0001']);
    assert.deepEqual(decision.discovered, ['PAGE-0001-IMPL', 'PAGE-0001-TEST']);
    assert.equal(decision.affected.length, 3);
    assert.match(decision.analysisHash, /^[0-9a-f]{64}$/);
  });

  it('admits a wholly new proposal base with no named artifacts', () => {
    const decision = evaluateChangeReopenRequest(new KnowledgeGraph(), {
      requestId: 'CR-2',
      discoveredBy: buildWorker,
      newProposalBaseId: 'FEATURE-9001',
      reason: 'Nothing certified covers the discovered capability.',
    });
    assert.equal(decision.verdict, 'ACCEPTED_FOR_RE_EVALUATION');
    assert.deepEqual(decision.declared, ['FEATURE-9001']);
  });

  it('fails closed when a certifier opens its own request', () => {
    const decision = evaluateChangeReopenRequest(graphWithChain(), {
      requestId: 'CR-3',
      discoveredBy: DESIGN_BOSS,
      namedArtifacts: ['PAGE-0001'],
      reason: 'Certifier attempting to self-adjudicate.',
    });
    assert.equal(decision.verdict, 'REJECTED_SELF_ADJUDICATION');
  });

  it('fails closed when the Safe Change certifiers open a request (verifier, not producer)', () => {
    const safeChangeBoss = { kind: 'ai' as const, id: 'safe-change-boss-01' };
    const safeChangeAuditor = { kind: 'verifier' as const, id: 'safe-change-auditor-01' };
    for (const discoveredBy of [safeChangeBoss, safeChangeAuditor]) {
      const decision = evaluateChangeReopenRequest(graphWithChain(), {
        requestId: 'CR-4',
        discoveredBy,
        namedArtifacts: ['PAGE-0001'],
        reason: 'A certifier must never open its own change request.',
      });
      assert.equal(decision.verdict, 'REJECTED_SELF_ADJUDICATION');
    }
  });

  it('rejects an invalid request (no reason, no named artifacts)', () => {
    const decision = evaluateChangeReopenRequest(graphWithChain(), {
      requestId: 'CR-5',
      discoveredBy: buildWorker,
      reason: '',
    });
    assert.equal(decision.verdict, 'REJECTED_INVALID');
  });

  it('is deterministic: identical input yields an identical decision', () => {
    const graph = graphWithChain();
    const input = {
      requestId: 'CR-6',
      discoveredBy: buildWorker,
      namedArtifacts: ['PAGE-0001'],
      reason: 'Determinism check.',
    };
    const a = evaluateChangeReopenRequest(graph, input);
    const b = evaluateChangeReopenRequest(graph, input);
    assert.equal(a.analysisHash, b.analysisHash);
    assert.deepEqual(a.affected, b.affected);
  });
});