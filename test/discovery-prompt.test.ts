/**
 * The discovery prompt layer.
 *
 * A real provider call proved the hard requirement: a working model can still
 * hand back prose instead of JSON, and the stage must survive that without
 * inventing data. These tests pin the exact behaviours that requirement
 * depends on.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  extractJson,
  renderBrief,
  DISCOVERY_SYSTEM_PROMPT,
  DISCOVERY_RESPONSE_SCHEMA,
  DISCOVERY_UNDERSTANDING_SCHEMA,
  DISCOVERY_STRUCTURAL_SCHEMA,
  BOSS_EXPECTATION_SCHEMA,
} from '../src/discovery/prompt.ts';

describe('extractJson', () => {
  it('parses a clean JSON object unchanged', () => {
    const value = extractJson('{"product":{"name":"Todo App","summary":"A todo app."}}');
    assert.deepEqual(value, { product: { name: 'Todo App', summary: 'A todo app.' } });
  });

  it('parses a clean JSON array', () => {
    assert.deepEqual(extractJson('[1,2,3]'), [1, 2, 3]);
  });

  it('strips a markdown code fence', () => {
    const raw = '```json\n{"ok":true}\n```';
    assert.deepEqual(extractJson(raw), { ok: true });
  });

  it('recovers JSON wrapped in prose', () => {
    const raw = [
      '**Request accepted.** Here is the discovery result you asked for:',
      '{"product":{"name":"Todo App","summary":"Tracks tasks."},"modules":[]}',
      'Let me know if you want changes.',
    ].join('\n');
    const value = extractJson(raw) as { product: { name: string } };
    assert.equal(value.product.name, 'Todo App');
  });

  it('recovers JSON that follows a markdown heading', () => {
    const raw = '## Discovery\n\n```\n{"product":{"name":"Todo App","summary":"s"}}\n```';
    const value = extractJson(raw) as { product: { name: string } };
    assert.equal(value.product.name, 'Todo App');
  });

  it('keeps braces that live inside string literals', () => {
    const raw = 'Result: {"note":"a } brace and a \\" quote","n":1} done';
    const value = extractJson(raw) as { note: string; n: number };
    assert.equal(value.note, 'a } brace and a " quote');
    assert.equal(value.n, 1);
  });

  it('keeps nested objects intact', () => {
    const raw = '{"a":{"b":{"c":[{"d":1}]}}}';
    assert.deepEqual(extractJson(raw), { a: { b: { c: [{ d: 1 }] } } });
  });

  it('fails honestly when the text holds no JSON at all', () => {
    assert.throws(() => extractJson('whatUserAsked for is a todo application, nothing structured here'), SyntaxError);
  });

  it('does not invent an empty object for an empty response', () => {
    assert.throws(() => extractJson(''), SyntaxError);
  });
});

describe('renderBrief', () => {
  it('carries the name, vision, users and constraints', () => {
    const text = renderBrief({
      name: 'Todo App',
      vision: 'Track tasks.',
      targetUsers: ['developers', 'teams'],
      constraints: ['offline first'],
    });
    assert.match(text, /Product name: Todo App/);
    assert.match(text, /Vision: Track tasks\./);
    assert.match(text, /Target users: developers, teams/);
    assert.match(text, /Constraints: offline first/);
  });

  it('omits the constraints line when there are none', () => {
    const text = renderBrief({ name: 'X', vision: 'Y', targetUsers: ['u'] });
    assert.doesNotMatch(text, /Constraints:/);
  });
});

describe('DISCOVERY_SYSTEM_PROMPT', () => {
  it('states the response schema so the model is never asked to guess it', () => {
    // A model cannot produce a schema it was never shown. The old prompt
    // merely NAMED the schema, which is why a real, working provider call
    // still failed the stage.
    assert.ok(DISCOVERY_SYSTEM_PROMPT.includes(DISCOVERY_RESPONSE_SCHEMA));
    assert.match(DISCOVERY_SYSTEM_PROMPT, /ONLY a JSON object/i);
  });

  it('the schema names every collection the parser validates', () => {
    for (const field of [
      'product',
      'modules',
      'features',
      'workflows',
      'pages',
      'rules',
      'permissions',
      'entities',
      'apis',
      'integrations',
    ]) {
      assert.ok(
        DISCOVERY_RESPONSE_SCHEMA.includes(`"${field}"`),
        `schema is missing the "${field}" collection`,
      );
    }
  });

  it('every schema template is valid JSON the model can copy verbatim', () => {
    for (const [name, schema] of [
      ['DISCOVERY_RESPONSE_SCHEMA', DISCOVERY_RESPONSE_SCHEMA],
      ['DISCOVERY_UNDERSTANDING_SCHEMA', DISCOVERY_UNDERSTANDING_SCHEMA],
      ['DISCOVERY_STRUCTURAL_SCHEMA', DISCOVERY_STRUCTURAL_SCHEMA],
      ['BOSS_EXPECTATION_SCHEMA', BOSS_EXPECTATION_SCHEMA],
    ] as const) {
      assert.doesNotThrow(
        () => JSON.parse(schema),
        `${name} is not valid JSON, so the model cannot copy it`,
      );
    }
  });

  it('the structural template carries every collection the parser validates', () => {
    for (const field of [
      'modules',
      'features',
      'workflows',
      'pages',
      'rules',
      'permissions',
      'entities',
      'apis',
      'integrations',
    ]) {
      assert.ok(
        DISCOVERY_STRUCTURAL_SCHEMA.includes(`"${field}"`),
        `schema is missing the "${field}" collection`,
      );
    }
  });
});
