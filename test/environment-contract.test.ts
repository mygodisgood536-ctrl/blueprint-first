/**
 * Environment contract (Architecture 3.3, Part V).
 *
 * The platform runs on Vercel with Neon, Daytona and owner-only infrastructure
 * secrets. A production deploy that boots without its database must FAIL rather
 * than quietly persist to an ephemeral disk, and a watchdog with no configured
 * secret must refuse to run rather than sit open on a public URL.
 *
 * Both of those depend on operators knowing which variables exist. That is why
 * `.env.example` is held to a contract here rather than treated as prose: every
 * variable the server reads must be documented, and no documented secret may
 * carry a real value in a file that is committed to the repository.
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

const REPO = process.cwd();
const sourceFiles = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
};

/** Every environment variable the server reads, gathered from the source. */
function environmentVariablesTheServerReads(): Set<string> {
  const found = new Set<string>();
  for (const file of [...sourceFiles(join(REPO, 'src')), ...sourceFiles(join(REPO, 'api'))]) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/process\.env\[['"]([A-Z0-9_]+)['"]\]/g)) {
      found.add(match[1] as string);
    }
    for (const match of source.matchAll(/\benv\[['"]([A-Z0-9_]+)['"]\]/g)) {
      found.add(match[1] as string);
    }
  }
  return found;
}

function documentedVariables(): Map<string, string> {
  const raw = readFileSync(join(REPO, '.env.example'), 'utf8');
  const map = new Map<string, string>();
  for (const line of raw.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match !== null) map.set(match[1] as string, match[2] as string);
  }
  return map;
}

/** Keys whose names describe storage or config, not a secret to be published. */
const NOT_SECRET = new Set(['BF_ENV', 'BF_LOG_LEVEL', 'BF_DATA_DIR', 'BF_WEB_HOST', 'BF_WEB_PORT', 'BF_SUPERVISOR_MODE', 'BF_REQUIRE_DATABASE', 'BF_AI_DEFAULT_PROVIDER', 'BF_AI_ROUTING', 'DAYTONA_API_URL', 'BF_BOOTSTRAP_FULL_NAME', 'BF_BOOTSTRAP_USERNAME', 'BF_BOOTSTRAP_GMAIL', 'BF_BOOTSTRAP_SECURITY_QUESTION']);

describe('.env.example documents the real deployment contract', () => {
  test('the file exists', () => {
    assert.equal(existsSync(join(REPO, '.env.example')), true);
  });

  test('every variable the server reads is documented', () => {
    const documented = documentedVariables();
    const undocumented = [...environmentVariablesTheServerReads()]
      .filter((name) => !documented.has(name))
      // PATH is supplied by the platform, not by an operator.
      .filter((name) => name !== 'PATH')
      .sort();
    assert.deepEqual(undocumented, [], `undocumented environment variables: ${undocumented.join(', ')}`);
  });

  test('no secret carries a real value in a committed file', () => {
    const offenders: string[] = [];
    for (const [key, value] of documentedVariables()) {
      if (NOT_SECRET.has(key)) continue;
      if (value.trim() !== '') offenders.push(`${key} has a non-empty value in .env.example`);
    }
    assert.deepEqual(offenders, [], 'a committed .env.example must contain placeholders only');
  });

  test('the platform owner security answer is documented as unset, never as a value', () => {
    const documented = documentedVariables();
    assert.equal(documented.has('BF_BOOTSTRAP_SECURITY_ANSWER'), true, 'the owner answer secret must be documented');
    assert.equal((documented.get('BF_BOOTSTRAP_SECURITY_ANSWER') ?? '').trim(), '');
  });

  test('the database and watchdog controls that make production fail closed are documented', () => {
    const documented = documentedVariables();
    for (const key of ['DATABASE_URL', 'BF_REQUIRE_DATABASE', 'CRON_SECRET', 'BF_WATCHDOG_SECRET']) {
      assert.equal(documented.has(key), true, `${key} must be documented`);
    }
  });

  test('no real .env file is committed', () => {
    assert.equal(existsSync(join(REPO, '.env')), false, 'a real .env must never be committed');
  });
});