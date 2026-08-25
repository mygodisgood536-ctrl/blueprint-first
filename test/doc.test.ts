import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createArtifact } from '../src/core/artifact.ts';
import {
  DOC_STATES,
  docStateOf,
  inferDocState,
  recordDocGate,
} from '../src/core/doc.ts';
import { DocStateError } from '../src/core/errors.ts';
import { makeServices } from './helpers/test-services.ts';
import { DiscoveryDepartment } from '../src/discovery/department/engine.ts';

const BRIEF = {
  name: 'TeamTask',
  vision: 'A lightweight task tracker that small teams can adopt in minutes.',
  targetUsers: ['small teams'],
};

const WORKER = { kind: 'ai' as const, id: 'structural-worker-01' };
const SYSTEM = { kind: 'system' as const, id: 'gate-fixture' };
const VERIFIER = { kind: 'verifier' as const, id: 'gate-fixture-verifier' };

function seed(services: ReturnType<typeof makeServices>): string {
  const artifact = createArtifact({
    id: services.allocator.nextId('FEATURE'),
    type: 'FEATURE',
    title: 'DoC fixture feature',
    description: 'Exercises the Definition-of-Complete machine.',
    projectId: 'PROJECT-0001',
    actor: WORKER,
  });
  void services.store.append(artifact);
  return artifact.id;
}

function governorFor(state: string): { kind: 'ai' | 'verifier' | 'system'; id: string } {
  switch (state) {
    case 'DISCOVERED':
    case 'EXPANDED':
      return WORKER;
    case 'SELF-VERIFIED':
      return SYSTEM;
    case 'SPECIALIST-VERIFIED':
      return VERIFIER;
    case 'BOSS-VERIFIED':
      return { kind: 'verifier', id: 'boss' };
    case 'DESIGNED':
      return WORKER;
    case 'IMPLEMENTED':
      return WORKER;
    case 'TESTED':
      return WORKER;
    case 'TEST-VERIFIED':
      return VERIFIER;
    default:
      return SYSTEM;
  }
}

describe('definition-of-complete state machine (§0.17)', () => {
  it('advances linearly through governed gates and records provenance', async () => {
    const services = makeServices();
    const id = seed(services);
    // AI-created artifacts START at DISCOVERED by inference; the first
    // recordable gate is therefore EXPANDED.
    let current = await recordDocGate(services.store, id, 'EXPANDED', WORKER, {});
    assert.equal(docStateOf(current), 'EXPANDED');
    current = await recordDocGate(services.store, id, 'SELF-VERIFIED', SYSTEM, {
      gate: 'self-check',
    });
    assert.equal(docStateOf(current), 'SELF-VERIFIED');
    assert.ok(
      current.provenance.some(
        (p) => p.action === 'doc-gate' && p.note?.includes('EXPANDED -> SELF-VERIFIED'),
      ),
    );
  });

  it('rejects skipped and backwards transitions', async () => {
    const services = makeServices();
    const id = seed(services); // starts at inferred DISCOVERED
    await assert.rejects(
      () =>
        recordDocGate(services.store, id, 'SPECIALIST-VERIFIED', VERIFIER, {
          gate: 'specialist-verifier',
        }),
      DocStateError,
    );
    await recordDocGate(services.store, id, 'EXPANDED', WORKER, {});
    await assert.rejects(
      () => recordDocGate(services.store, id, 'DISCOVERED', WORKER, {}),
      DocStateError,
    );
  });

  it('refuses producer self-declaration for judgment gates', async () => {
    const services = makeServices();
    const id = seed(services);
    await recordDocGate(services.store, id, 'EXPANDED', WORKER, {});
    // A worker's own "this is done" claim changes nothing about state.
    await assert.rejects(
      () =>
        recordDocGate(services.store, id, 'SELF-VERIFIED', WORKER, {
          gate: 'self-check',
        }),
      /independent judge/,
    );
  });

  it('protects the terminal state across the full walk', async () => {
    const services = makeServices();
    const id = seed(services);
    let last: string | undefined;
    // Creation implies DISCOVERED; walk every subsequent gate.
    for (const state of DOC_STATES.slice(1)) {
      const updated = await recordDocGate(
        services.store,
        id,
        state,
        governorFor(state),
        { gate: state },
      );
      last = docStateOf(updated);
      assert.equal(last, state);
    }
    assert.equal(last, 'CERTIFIED COMPLETE');
    await assert.rejects(
      () => recordDocGate(services.store, id, 'DISCOVERED', WORKER, {}),
      DocStateError,
    );
  });

  it('infers BOSS-VERIFIED from recorded Level-1b provenance', async () => {
    const services = makeServices();
    const department = await new DiscoveryDepartment(services).discover(BRIEF);
    assert.equal(department.status, 'accepted');
    const project = await services.store.require('PROJECT-0001');
    assert.equal(inferDocState(project), 'BOSS-VERIFIED');
  });
});