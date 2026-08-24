import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ScaffoldedProductDiscoveryEngine } from '../src/engines/product-discovery-engine.ts';
import { ScaffoldedAiDesignStudio } from '../src/engines/ai-design-studio.ts';
import { ScaffoldedAiBuildStudio } from '../src/engines/ai-build-studio.ts';
import { EngineNotImplementedError } from '../src/core/errors.ts';

/**
 * Guards against "fake button" regressions: scaffolded engines must loudly
 * refuse to run instead of pretending to produce results.
 */
describe('scaffolded engines refuse to fake work', () => {
  it('discovery engine reports its roadmap level when invoked', async () => {
    const engine = new ScaffoldedProductDiscoveryEngine();
    assert.equal(engine.descriptor.status, 'scaffolded');
    await assert.rejects(
      () => engine.discover('a product brief'),
      (error: unknown) =>
        error instanceof EngineNotImplementedError &&
        /ProductDiscoveryEngine\.discover/.test(error.message) &&
        /roadmap level 1a/.test(error.message),
    );
  });

  it('design studio refuses to fabricate blueprints', async () => {
    await assert.rejects(
      () => new ScaffoldedAiDesignStudio().designBlueprint({
        productName: 'x',
        pages: [],
        assumptions: [],
        openQuestions: [],
      }),
      EngineNotImplementedError,
    );
  });

  it('build studio refuses to fabricate implementations', async () => {
    await assert.rejects(
      () => new ScaffoldedAiBuildStudio().build({ artifactIds: [], approvedBy: 'nobody' }),
      EngineNotImplementedError,
    );
  });
});
