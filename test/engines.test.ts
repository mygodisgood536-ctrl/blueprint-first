import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SinglePassDiscoveryEngine } from '../src/discovery/engine.ts';
import { makeServices } from './helpers/test-services.ts';

/**
 * Engine contract checks. Discovery is implemented at Level 1a; Design and
 * Build are updated here as they come online in this stage.
 */
describe('level 1a engine contracts', () => {
  it('discovery engine reports implemented status and target level', () => {
    const engine = new SinglePassDiscoveryEngine(makeServices());
    assert.equal(engine.descriptor.name, 'ProductDiscoveryEngine');
    assert.equal(engine.descriptor.targetLevel, '1a');
    assert.equal(engine.descriptor.status, 'implemented');
  });
});

