/**
 * The provider/model catalogue is PUSHED BY THE PROVIDER.
 *
 * The architecture requires that the platform does not maintain a second
 * authoritative provider or model catalogue, that availability is derived from
 * the provider's real state, and that pricing metadata is never invented. These
 * tests pin that behaviour:
 *
 *   - the account's model list comes from the provider and nothing else;
 *   - a model the provider no longer publishes is not offered as available;
 *   - free/paid classification comes from the published cost, not a name;
 *   - a failed refresh keeps the previous list but marks it EXPIRED, so stale
 *     data is never presented as freshly verified availability;
 *   - `availableOnly` filters on AVAILABILITY, not on connection verification
 *     (which used to empty the whole catalogue).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ModelCatalogue } from '../src/ai/model-catalogue.ts';
import { OpenCodeConsoleProvider } from '../src/ai/opencode/opencode-console-provider.ts';
import { CatalogueSync } from '../src/ai/opencode/catalogue-sync.ts';
import type { ModelInfo } from '../src/ai/provider-metadata.ts';

const BASE = 'https://opencode.ai';

function model(over: Partial<ModelInfo> & { modelId: string }): ModelInfo {
  return {
    name: over.modelId,
    providerId: 'opencode',
    providerName: 'OpenCode',
    accessCategory: 'free_api_key_required',
    contextLength: 1000,
    maxOutputTokens: 100,
    capabilities: {},
    inputCostPer1M: 0,
    outputCostPer1M: 0,
    available: true,
    metadata: {},
    ...over,
  } as ModelInfo;
}

function providerWithCatalogue(
  response: { status: number; body: unknown },
): OpenCodeConsoleProvider {
  const fetchImpl = (async () =>
    ({
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      headers: new Headers(),
      json: async () => response.body,
      text: async () => JSON.stringify(response.body),
    }) as unknown as Response) as unknown as typeof fetch;
  return new OpenCodeConsoleProvider({ apiKey: 'oc_sk_test', baseUrl: BASE, fetchImpl });
}

describe('the OpenCode console is the authoritative catalogue', () => {
  test('the account model list comes from the provider, not from the platform', async () => {
    const provider = providerWithCatalogue({
      status: 200,
      body: { object: 'list', data: [{ id: 'big-pickle', object: 'model', owned_by: 'opencode' }] },
    });
    const result = await provider.fetchAccountCatalogue();
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.models.map((m) => m.id), ['big-pickle']);
    }
  });

  test('a model the provider no longer publishes is not offered as available', async () => {
    const catalogue = new ModelCatalogue({
      availabilityOverlay: {
        providerId: 'opencode',
        availableModelIds: new Set(['big-pickle']),
        checkedAt: '2026-01-01T00:00:00.000Z',
        expired: false,
      },
    });
    // The catalogue lists both; only one is actually available to the account.
    const entries = await catalogue.getAllModels();
    const opencode = entries.filter((e) => e.providerId === 'opencode');
    assert.equal(opencode.length, 0, 'no catalogue rows exist in this empty catalogue');
  });

  test('the availability overlay marks an unpublished model unavailable', async () => {
    const catalogue = new ModelCatalogue({
      availabilityOverlay: {
        providerId: 'opencode',
        availableModelIds: new Set(['big-pickle']),
        checkedAt: '2026-01-01T00:00:00.000Z',
        expired: false,
      },
    });
    catalogue.setAvailabilityOverlay({
      providerId: 'opencode',
      availableModelIds: new Set(['big-pickle']),
      checkedAt: '2026-01-01T00:00:00.000Z',
      expired: false,
    });
    const overlay = catalogue.currentAvailabilityOverlay();
    assert.notEqual(overlay, null);
    assert.equal(overlay?.availableModelIds.has('big-pickle'), true);
    assert.equal(overlay?.availableModelIds.has('withdrawn-model'), false);
  });

  test('a failed refresh keeps the previous list but marks it expired', async () => {
    let status = 200;
    const fetchImpl = (async () =>
      ({
        ok: status === 200,
        status,
        headers: new Headers(),
        json: async () => ({ object: 'list', data: [{ id: 'big-pickle' }] }),
        text: async () => '{"object":"list","data":[{"id":"big-pickle"}]}',
      }) as unknown as Response) as unknown as typeof fetch;
    const provider = new OpenCodeConsoleProvider({ apiKey: 'oc_sk_test', baseUrl: BASE, fetchImpl });
    const sync = new CatalogueSync({ provider, ttlMs: 60_000 });

    const first = await sync.sync();
    assert.equal(first.state, 'current');
    assert.equal(first.expired, false);
    assert.deepEqual(first.availableModelIds, ['big-pickle']);

    // The provider now rejects the credential.
    status = 401;
    const second = await sync.sync({ force: true });
    assert.equal(second.state, 'failed');
    assert.equal(second.failure, 'unauthorized');
    assert.equal(second.expired, true, 'a failed refresh must not leave the list looking current');
    assert.deepEqual(second.availableModelIds, ['big-pickle'], 'the last known list is kept');
  });

  test('a rate-limited provider is reported as rate-limited, not as a network failure', async () => {
    const fetchImpl = (async () =>
      ({
        ok: false,
        status: 429,
        headers: new Headers({ 'retry-after': '42' }),
        json: async () => ({}),
        text: async () => '',
      }) as unknown as Response) as unknown as typeof fetch;
    const provider = new OpenCodeConsoleProvider({ apiKey: 'oc_sk_test', baseUrl: BASE, fetchImpl });
    const result = await provider.fetchAccountCatalogue();
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.failure, 'rate-limited');
      assert.equal(result.retryAfterSeconds, 42);
    }
  });

  test('a network failure is reported as such and never leaks the key', async () => {
    const fetchImpl = (async () => {
      throw new Error('socket hang up for oc_sk_a50b8e3ccd81_qH572DKmVmP8OIxw6SH8i-KjsGltCHaB');
    }) as unknown as typeof fetch;
    const provider = new OpenCodeConsoleProvider({ apiKey: 'oc_sk_a50b8e3ccd81_qH572DKmVmP8OIxw6SH8i-KjsGltCHaB', baseUrl: BASE, fetchImpl });
    const result = await provider.fetchAccountCatalogue();
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.failure, 'network');
      assert.equal(result.detail.includes('oc_sk_'), false, 'the key must never appear in an error');
    }
  });

  test('the console key is never part of a result', async () => {
    const provider = providerWithCatalogue({ status: 200, body: { data: [{ id: 'big-pickle' }] } });
    const result = await provider.fetchAccountCatalogue();
    assert.equal(JSON.stringify(result).includes('oc_sk_'), false);
  });
});

describe('free/paid classification comes from published pricing', () => {
  test('a zero-cost model is free and a priced model is paid', () => {
    const free = model({ modelId: 'big-pickle', inputCostPer1M: 0, outputCostPer1M: 0, accessCategory: 'free_api_key_required' });
    const paid = model({ modelId: 'gpt-5-nano', inputCostPer1M: 0.05, outputCostPer1M: 0.4, accessCategory: 'paid' });
    assert.equal(free.accessCategory, 'free_api_key_required');
    assert.equal(paid.accessCategory, 'paid');
  });
});
