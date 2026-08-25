import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SinglePassDiscoveryEngine } from '../src/discovery/engine.ts';
import { AiDesignStudio } from '../src/design/studio.ts';
import { ScaffoldedAiBuildStudio } from '../src/engines/ai-build-studio.ts';
import { EngineNotImplementedError } from '../src/core/errors.ts';
import { makeServices } from './helpers/test-services.ts';

/**
 * Engine contract checks. Discovery and Design are implemented at Level 1a;
 * Build is updated here when it comes online in this stage.
 */
describe('level 1a engine contracts', () => {
  it('discovery engine reports implemented status and target level', () => {
    const engine = new SinglePassDiscoveryEngine(makeServices());
    assert.equal(engine.descriptor.name, 'ProductDiscoveryEngine');
    assert.equal(engine.descriptor.targetLevel, '1a');
    assert.equal(engine.descriptor.status, 'implemented');
  });

  it('AI Design Studio reports implemented status and target level', () => {
    const studio = new AiDesignStudio(makeServices());
    assert.equal(studio.descriptor.name, 'AiDesignStudio');
    assert.equal(studio.descriptor.targetLevel, '1a');
    assert.equal(studio.descriptor.status, 'implemented');
  });

  it('AI Build Studio still refuses to run while scaffolded', async () => {
    const studio = new ScaffoldedAiBuildStudio();
    assert.equal(studio.descriptor.name, 'AiBuildStudio');
    assert.equal(studio.descriptor.status, 'scaffolded');
    await assert.rejects(
      () => studio.build({ artifactIds: ['BLUEPRINT-0001'], approvedBy: 'product-owner-01' }),
      EngineNotImplementedError,
    );
  });
});

