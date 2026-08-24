import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SinglePassDiscoveryEngine } from '../src/discovery/engine.ts';
import { parseDiscoveryResult } from '../src/discovery/parse.ts';
import { normalizeDiscovery } from '../src/discovery/normalize.ts';
import { DiscoveryParseError, DiscoveryValidationError, InvalidBriefError } from '../src/discovery/errors.ts';
import { makeServices, SAMPLE_DISCOVERY_JSON } from './helpers/test-services.ts';

const BRIEF = {
  name: 'TeamTask',
  vision: 'A lightweight task tracker that small teams can adopt in minutes.',
  targetUsers: ['small teams'],
};

describe('brief validation', () => {
  it('rejects empty name / short vision / missing users', async () => {
    const engine = () => new SinglePassDiscoveryEngine(makeServices());
    await assert.rejects(() => engine().discover({ ...BRIEF, name: ' ' }), InvalidBriefError);
    await assert.rejects(() => engine().discover({ ...BRIEF, vision: 'short' }), InvalidBriefError);
    await assert.rejects(() => engine().discover({ ...BRIEF, targetUsers: [] }), InvalidBriefError);
  });
});

describe('structural parsing', () => {
  it('collects multiple problems in one pass', () => {
    try {
      parseDiscoveryResult({ product: {}, modules: 'nope' });
      assert.fail('expected throw');
    } catch (error) {
      assert.ok(error instanceof DiscoveryParseError);
      assert.match(error.message, /product\.name/);
      assert.match(error.message, /product\.summary/);
      assert.match(error.message, /modules: must be an array/);
    }
  });

  it('rejects bad api methods and entity field types', () => {
    const bad = {
      product: { name: 'x', summary: 'y' },
      apis: [{ key: 'a', method: 'PATCH', path: 'nope', purpose: 'p' }],
      entities: [{ key: 'e', name: 'E', fields: [{ name: 'f', type: 'float', required: 'yes' }] }],
    };
    assert.throws(() => parseDiscoveryResult(bad), DiscoveryParseError);
  });

  it('tolerates markdown fences around the JSON', () => {
    const fenced = '```json\n' + JSON.stringify(SAMPLE_DISCOVERY_JSON) + '\n```';
    const parsed = JSON.parse(fenced.replace(/^```[a-zA-Z]*\s*\n/, '').replace(/```\s*$/, ''));
    const normalized = normalizeDiscovery(parseDiscoveryResult(parsed));
    assert.equal(normalized.counts.pages, 2);
  });
});

describe('semantic normalization', () => {
  it('detects duplicate keys', () => {
    const duped = structuredClone(SAMPLE_DISCOVERY_JSON);
    (duped.modules as unknown[]).push({ key: 'tasks', title: 'Dup', purpose: 'dup' });
    assert.throws(
      () => normalizeDiscovery(parseDiscoveryResult(duped)),
      (error: unknown) =>
        error instanceof DiscoveryValidationError && /duplicate key "tasks"/.test(error.message),
    );
  });

  it('detects dangling references (feature->module, api->entity)', () => {
    const bad1 = structuredClone(SAMPLE_DISCOVERY_JSON);
    (bad1.features as { moduleKey: string }[])[0].moduleKey = 'ghost';
    assert.throws(() => normalizeDiscovery(parseDiscoveryResult(bad1)), /unknown module "ghost"/);

    const bad2 = structuredClone(SAMPLE_DISCOVERY_JSON);
    (bad2.apis as { requestEntityKey?: string }[])[0].requestEntityKey = 'unicorn';
    assert.throws(
      () => normalizeDiscovery(parseDiscoveryResult(bad2)),
      /unknown entity "unicorn"/,
    );
  });

  it('sorts collections deterministically and reports counts', () => {
    const shuffled = structuredClone(SAMPLE_DISCOVERY_JSON);
    const modules = [...(shuffled.modules as unknown[])];
    modules.reverse();
    (shuffled.modules as unknown[]) = modules;
    const inventory = normalizeDiscovery(parseDiscoveryResult(shuffled));
    assert.deepEqual(inventory.sorted.modules.map((m) => m.key), ['projects', 'tasks']);
    assert.equal(inventory.counts.actions, 4);
    assert.equal(inventory.counts.validations, 2);
  });
});
