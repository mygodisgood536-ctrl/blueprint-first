import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AiRouter } from '../src/ai/router.ts';
import { ScriptedProvider } from '../src/ai/scripted-provider.ts';
import { RoutingError } from '../src/core/errors.ts';

describe('ai router', () => {
  function routerWithRules(): AiRouter {
    // Fresh providers per test - ScriptedProvider queues are stateful.
    const discoveryProvider = new ScriptedProvider({ id: 'discovery-model', queue: ['found pages'] });
    const fallback = new ScriptedProvider({ id: 'fallback', queue: ['fallback says hi'] });
    const router = new AiRouter();
    router.register(discoveryProvider);
    router.register(fallback);
    router.setRoute('DISCOVERY', 'discovery-model');
    router.setDefaultProvider('fallback');
    return router;
  }

  it('rejects duplicate provider registration', () => {
    const router = new AiRouter();
    router.register(new ScriptedProvider({ id: 'fallback' }));
    assert.throws(() => router.register(new ScriptedProvider({ id: 'fallback' })), /already registered/);
  });

  it('prefers task-specific rules over the default', async () => {
    const router = routerWithRules();
    const response = await router.complete({
      taskType: 'DISCOVERY',
      messages: [{ role: 'user', content: 'brief' }],
    });
    assert.equal(response.providerId, 'discovery-model');
    assert.equal(response.modelId, 'discovery-model-deterministic-v1');
  });

  it('falls back to the default provider when no rule matches', async () => {
    const router = routerWithRules();
    const response = await router.complete({
      taskType: 'OPERATIONS',
      messages: [{ role: 'user', content: 'status' }],
    });
    assert.equal(response.providerId, 'fallback');
    assert.equal(router.resolve('OPERATIONS').matchedBy, 'default');
  });

  it('fails loudly on unregistered routes and missing defaults', () => {
    const router = routerWithRules();
    router.setRoute('BUILD', 'does-not-exist');
    assert.throws(() => router.resolve('BUILD'), /unregistered provider/);
    const bare = new AiRouter();
    assert.throws(() => bare.resolve('DESIGN'), /No route for task/);
  });

  it('records completed selections with model identity for provenance', async () => {
    const router = routerWithRules();
    await router.complete({ taskType: 'DISCOVERY', messages: [{ role: 'user', content: 'b' }] });
    await router.complete({ taskType: 'REVIEW', messages: [{ role: 'user', content: 'r' }] });
    assert.deepEqual(
      router.completedSelections.map((s) => `${s.taskType}:${s.providerId}:${s.modelId}`),
      [
        'DISCOVERY:discovery-model:discovery-model-deterministic-v1',
        'REVIEW:fallback:fallback-deterministic-v1',
      ],
    );
  });

  it('detects providers that mis-stamp their responses', async () => {
    const liar: import('../src/ai/provider.ts').AiProvider = {
      id: 'liar',
      complete: async () => ({
        content: 'x',
        providerId: 'someone-else',
        modelId: 'm',
      }),
    };
    const router = new AiRouter();
    router.register(liar).setDefaultProvider('liar');
    await assert.rejects(() => router.complete({ taskType: 'DESIGN', messages: [] }), RoutingError);
  });
});
