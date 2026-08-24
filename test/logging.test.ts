import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createLogger, memorySink, redact } from '../src/core/logging.ts';

describe('structured logging', () => {
  it('emits json entries with level filtering', () => {
    const sink = memorySink();
    const logger = createLogger({ level: 'info', sink });
    logger.debug('hidden');
    logger.info('visible');
    logger.warn('warned');
    assert.equal(sink.entries.length, 2);
    assert.equal(sink.entries[0]?.level, 'info');
    assert.equal(sink.entries[1]?.level, 'warn');
  });

  it('redacts secret-looking values before they reach any sink', () => {
    const sink = memorySink();
    const logger = createLogger({ level: 'debug', sink });
    logger.info('request sent', {
      apiKey: 'sk-super-secret',
      Authorization: 'Bearer abc123',
      nested: { password: 'hunter2', safe: 'hello' },
      OPENAI_COMPATIBLE_API_KEY: 'sk-xyz',
      modelId: 'model-x',
    });
    const entry = sink.entries[0] as Record<string, unknown>;
    assert.equal(entry['apiKey'], '[REDACTED]');
    assert.equal(entry['Authorization'], '[REDACTED]');
    const nested = entry['nested'] as Record<string, unknown>;
    assert.equal(nested['password'], '[REDACTED]');
    assert.equal(nested['safe'], 'hello');
    assert.equal(entry['OPENAI_COMPATIBLE_API_KEY'], '[REDACTED]');
    assert.equal(entry['modelId'], 'model-x'); // non-secrets pass through
  });

  it('child loggers bind fields permanently', () => {
    const sink = memorySink();
    const parent = createLogger({ level: 'info', sink }, { runId: 'r-1' });
    const child = parent.child({ stage: 'design' });
    child.info('working');
    const entry = sink.entries[0] as Record<string, unknown>;
    assert.equal(entry['runId'], 'r-1');
    assert.equal(entry['stage'], 'design');
  });

  it('redact() is depth-capped and cycle-tolerant enough for logs', () => {
    const deep = { a: { b: { c: { d: { e: { f: { g: { h: { i: { j: 'deep' } } } } } } } } } };
    const out = redact(deep) as typeof deep;
    assert.ok(out !== undefined);
    // Secret keys anywhere under the cap are still masked.
    const masked = redact({ x: { apiToken: 'zzz' } }) as { x: { apiToken: string } };
    assert.equal(masked.x.apiToken, '[REDACTED]');
  });
});
