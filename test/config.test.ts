import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadConfig,
  parseRoutingOverrides,
  resolveOpenAiCredentials,
} from '../src/core/config.ts';
import { ConfigurationError } from '../src/core/errors.ts';

describe('configuration loading', () => {
  it('falls back to secure/deterministic defaults', () => {
    const config = loadConfig({});
    assert.equal(config.envName, 'development');
    assert.equal(config.logLevel, 'info');
    assert.equal(config.dataDir, './data');
    assert.equal(config.ai.defaultProvider, 'scripted');
    assert.deepEqual(config.ai.routing, {});
  });

  it('reads overrides and parses routing pairs', () => {
    const config = loadConfig({
      BF_ENV: 'staging',
      BF_LOG_LEVEL: 'warn',
      BF_DATA_DIR: '/srv/bf-data',
      BF_AI_DEFAULT_PROVIDER: 'openai-compatible',
      BF_AI_ROUTING: 'DISCOVERY=openai-compatible,DESIGN=scripted',
    });
    assert.equal(config.logLevel, 'warn');
    assert.equal(config.ai.defaultProvider, 'openai-compatible');
    assert.equal(config.ai.routing['DISCOVERY'], 'openai-compatible');
    assert.equal(config.ai.routing['DESIGN'], 'scripted');
  });

  it('rejects malformed routing strings with helpful errors', () => {
    assert.throws(() => parseRoutingOverrides('DISCOVERY=openai-compatible,bogus'), ConfigurationError);
    assert.throws(() => parseRoutingOverrides('NOT_A_TASK=scripted'), /not a known AI task type/);
    assert.throws(() => parseRoutingOverrides('=scripted'), ConfigurationError);
  });

  it('rejects invalid log levels early', () => {
    assert.throws(() => loadConfig({ BF_LOG_LEVEL: 'loud' }), ConfigurationError);
  });
});

describe('provider credential resolution', () => {
  const settings = {
    baseUrlEnvVar: 'OPENAI_COMPATIBLE_BASE_URL',
    modelEnvVar: 'OPENAI_COMPATIBLE_MODEL',
    apiKeyEnvVar: 'OPENAI_COMPATIBLE_API_KEY',
    timeoutMs: 1000,
  };

  it('names missing env vars without ever exposing values', () => {
    try {
      resolveOpenAiCredentials(settings, { OPENAI_COMPATIBLE_BASE_URL: 'https://api.example.com' });
      assert.fail('expected throw');
    } catch (error) {
      assert.ok(error instanceof ConfigurationError);
      assert.match(error.message, /OPENAI_COMPATIBLE_MODEL/);
      assert.match(error.message, /OPENAI_COMPATIBLE_API_KEY/);
      // Values that WERE provided must not leak into the error text.
      assert.doesNotMatch(error.message, /api\.example\.com/);
    }
  });

  it('rejects malformed base urls', () => {
    assert.throws(
      () =>
        resolveOpenAiCredentials(settings, {
          OPENAI_COMPATIBLE_BASE_URL: 'not-a-url',
          OPENAI_COMPATIBLE_MODEL: 'm',
          OPENAI_COMPATIBLE_API_KEY: 'k',
        }),
      /not a valid absolute URL/,
    );
  });

  it('resolves fully-provided credentials', () => {
    const creds = resolveOpenAiCredentials(settings, {
      OPENAI_COMPATIBLE_BASE_URL: 'https://api.example.com/v1/',
      OPENAI_COMPATIBLE_MODEL: 'gpt-test',
      OPENAI_COMPATIBLE_API_KEY: 'secret-key-value',
    });
    assert.equal(creds.baseUrl, 'https://api.example.com/v1/');
    assert.equal(creds.model, 'gpt-test');
    assert.equal(creds.apiKey, 'secret-key-value');
  });
});
