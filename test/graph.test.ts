import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { KnowledgeGraph, syncArtifactToGraph } from '../src/core/graph.ts';
import { GraphIntegrityError } from '../src/core/errors.ts';

function wiredGraph(): KnowledgeGraph {
  const graph = new KnowledgeGraph();
  for (const id of ['PROJECT-0001', 'FEATURE-0001', 'PAGE-0001', 'PAGE-0001-DESIGN']) {
    graph.addNode(id);
  }
  return graph;
}

describe('knowledge graph integrity', () => {
  it('rejects links to unregistered nodes', () => {
    const graph = new KnowledgeGraph();
    graph.addNode('PAGE-0001');
    assert.throws(() => graph.link('PAGE-0001', 'DEPENDS_ON', 'FEATURE-0009'), GraphIntegrityError);
  });

  it('forbids self-dependency and self-derivation', () => {
    const graph = new KnowledgeGraph();
    graph.addNode('PAGE-0001');
    assert.throws(() => graph.link('PAGE-0001', 'DEPENDS_ON', 'PAGE-0001'), GraphIntegrityError);
    assert.throws(() => graph.link('PAGE-0001', 'DERIVED_FROM', 'PAGE-0001'), GraphIntegrityError);
    // Weak relations may be reflexive.
    assert.doesNotThrow(() => graph.link('PAGE-0001', 'RELATES_TO', 'PAGE-0001'));
  });

  it('deduplicates exact triples and reports creation status', () => {
    const graph = wiredGraph();
    assert.equal(graph.link('PAGE-0001', 'DEPENDS_ON', 'FEATURE-0001'), 'created');
    assert.equal(graph.link('PAGE-0001', 'DEPENDS_ON', 'FEATURE-0001'), 'existing');
    assert.equal(graph.allEdges().length, 1);
  });
});

describe('knowledge graph traversal', () => {
  function populated(): KnowledgeGraph {
    const graph = wiredGraph();
    // PROJECT <- FEATURE <- PAGE <- DESIGN (upstream direction)
    graph.link('FEATURE-0001', 'DEPENDS_ON', 'PROJECT-0001');
    graph.link('PAGE-0001', 'DEPENDS_ON', 'FEATURE-0001');
    graph.link('PAGE-0001-DESIGN', 'DERIVED_FROM', 'PAGE-0001');
    return graph;
  }

  it('traverses multi-hop upstream and downstream deterministically', () => {
    const graph = populated();
    assert.deepEqual(graph.reachable('PAGE-0001', 'downstream'), ['FEATURE-0001', 'PROJECT-0001']);
    assert.deepEqual(graph.reachable('PROJECT-0001', 'upstream'), [
      'FEATURE-0001',
      'PAGE-0001',
      'PAGE-0001-DESIGN',
    ]);
  });

  it('filters traversal by relation type', () => {
    const graph = populated();
    assert.deepEqual(graph.reachable('PAGE-0001-DESIGN', 'downstream', 'DERIVED_FROM'), ['PAGE-0001']);
    assert.deepEqual(graph.reachable('PAGE-0001-DESIGN', 'downstream', 'DEPENDS_ON'), []);
  });

  it('finds dependency cycles', () => {
    const graph = new KnowledgeGraph();
    for (const id of ['API-0001', 'ENTITY-0001']) graph.addNode(id);
    graph.link('API-0001', 'DEPENDS_ON', 'ENTITY-0001');
    graph.link('ENTITY-0001', 'DEPENDS_ON', 'API-0001');
    const cycles = graph.findDependencyCycles();
    assert.equal(cycles.length, 1);
    const cycle = cycles[0];
    assert.ok(cycle);
    // Cycle path closes on its start node; unique members are the two ids.
    assert.deepEqual([...new Set(cycle)].sort(), ['API-0001', 'ENTITY-0001']);
    assert.equal(cycle[0], cycle[cycle.length - 1]);
  });

  it('reports incoming edges for coverage tracing', () => {
    const graph = populated();
    // Only the design artifact points AT the page (DERIVED_FROM).
    const incoming = graph.incoming('PAGE-0001');
    assert.equal(incoming.length, 1);
    const incomingDerived = graph.incoming('PAGE-0001', 'DERIVED_FROM');
    assert.deepEqual(incomingDerived.map((e) => e.from), ['PAGE-0001-DESIGN']);
  });

  it('syncArtifactToGraph registers nodes and dependency edges', () => {
    const graph = new KnowledgeGraph();
    syncArtifactToGraph(graph, {
      id: 'PAGE-0002',
      dependencies: ['FEATURE-0001', 'RULE-0003'],
    });
    assert.ok(graph.hasEdge('PAGE-0002', 'DEPENDS_ON', 'FEATURE-0001'));
    assert.ok(graph.hasEdge('PAGE-0002', 'DEPENDS_ON', 'RULE-0003'));
    const stats = graph.stats();
    assert.equal(stats.nodeCount, 3);
    assert.equal(stats.byRelation['DEPENDS_ON'], 2);
  });
});
