import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatArtifactId,
  parseArtifactId,
  isBaseArtifactId,
  baseOf,
  lineageChain,
  ARTIFACT_TYPES,
} from '../src/core/ids.ts';
import { InvalidArtifactIdError } from '../src/core/errors.ts';

describe('artifact id formatting', () => {
  it('zero-pads numbers to canonical four digits', () => {
    assert.equal(formatArtifactId('PAGE', 42), 'PAGE-0042');
    assert.equal(formatArtifactId('API', 1), 'API-0001');
  });

  it('appends phase suffixes in order', () => {
    assert.equal(formatArtifactId('PAGE', 42, ['DESIGN']), 'PAGE-0042-DESIGN');
    assert.equal(formatArtifactId('PAGE', 42, ['DESIGN', 'IMPL']), 'PAGE-0042-DESIGN-IMPL');
  });

  it('rejects unknown types and invalid numbers', () => {
    // @ts-expect-error deliberately wrong type
    assert.throws(() => formatArtifactId('WIDGET', 1), InvalidArtifactIdError);
    assert.throws(() => formatArtifactId('PAGE', 0), InvalidArtifactIdError);
    assert.throws(() => formatArtifactId('PAGE', 1.5), InvalidArtifactIdError);
  });
});

describe('artifact id parsing', () => {
  it('round-trips canonical ids', () => {
    const parsed = parseArtifactId('PAGE-0042');
    assert.equal(parsed.type, 'PAGE');
    assert.equal(parsed.number, 42);
    assert.deepEqual(parsed.phases, []);
    assert.equal(parsed.canonical, 'PAGE-0042');

    const phased = parseArtifactId('PAGE-0042-DESIGN');
    assert.deepEqual(phased.phases, ['DESIGN']);
    assert.equal(phased.canonical, 'PAGE-0042-DESIGN');
  });

  it('accepts five-digit growth without leading zeros', () => {
    const parsed = parseArtifactId('FEATURE-12345');
    assert.equal(parsed.number, 12345);
    assert.equal(parsed.canonical, 'FEATURE-12345');
  });

  it('rejects non-canonical padding', () => {
    assert.throws(() => parseArtifactId('PAGE-42'), InvalidArtifactIdError);
    assert.throws(() => parseArtifactId('PAGE-000042'), InvalidArtifactIdError);
  });

  it('rejects unknown types, unknown phases, bad phase order', () => {
    assert.throws(() => parseArtifactId('WIDGET-0001'), InvalidArtifactIdError);
    assert.throws(() => parseArtifactId('PAGE-0001-WAT'), InvalidArtifactIdError);
    assert.throws(() => parseArtifactId('PAGE-0001-IMPL-DESIGN'), InvalidArtifactIdError);
    assert.throws(() => parseArtifactId('PAGE-0001-DESIGN-DESIGN'), InvalidArtifactIdError);
    assert.throws(() => parseArtifactId('PAGE'), InvalidArtifactIdError);
    assert.throws(() => parseArtifactId(''), InvalidArtifactIdError);
  });
});

describe('base detection and lineage chains', () => {
  it('detects base vs phase artifacts', () => {
    assert.equal(isBaseArtifactId('PAGE-0042'), true);
    assert.equal(isBaseArtifactId('PAGE-0042-TEST'), false);
    assert.equal(baseOf('PAGE-0042-TEST'), 'PAGE-0042');
    assert.equal(baseOf('PAGE-0042-DEPLOY-OPS'), 'PAGE-0042');
  });

  it('builds the full architecture lineage chain deterministically', () => {
    assert.deepEqual(lineageChain('PAGE-0042'), [
      'PAGE-0042',
      'PAGE-0042-DESIGN',
      'PAGE-0042-IMPL',
      'PAGE-0042-TEST',
      'PAGE-0042-DEPLOY',
      'PAGE-0042-OPS',
      'PAGE-0042-PERM',
    ]);
    assert.deepEqual(lineageChain('API-0007', ['DESIGN', 'IMPL']), [
      'API-0007',
      'API-0007-DESIGN',
      'API-0007-IMPL',
    ]);
  });

  it('refuses to build a chain from a phased id', () => {
    assert.throws(() => lineageChain('PAGE-0042-IMPL'), InvalidArtifactIdError);
  });

  it('exposes every declared artifact type as parseable', () => {
    for (const type of ARTIFACT_TYPES) {
      const id = formatArtifactId(type, 9999);
      assert.equal(parseArtifactId(id).type, type);
    }
  });
});
