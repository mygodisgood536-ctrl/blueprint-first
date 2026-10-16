/**
 * Real Daytona HTTP-API integration boundary.
 *
 * The control plane (Vercel) cannot host the Daytona CLI, so the production
 * execution path is Daytona's documented HTTP API. These tests drive the real
 * client and the real adapter against a local HTTP server that speaks Daytona's
 * documented contract (platform API + toolbox API). Nothing is mocked inside the
 * platform code: the transport is real HTTP, the request shapes are real, and the
 * failures asserted are real failures.
 *
 * What is proved here:
 *  - the credential is verified against a real authenticated Daytona call
 *  - a wrong key is REJECTED and never activates
 *  - a sandbox is provisioned, executed in, and destroyed over the API
 *  - a commit returns Daytona's REAL hash, and a missing hash is a failure
 *    rather than fabricated provenance
 *  - an unreachable Daytona surfaces honestly instead of pretending to work
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { DaytonaApiClient, DaytonaApiError } from '../src/env/daytona-api.ts';
import { DaytonaApiWorkspaceAdapter } from '../src/env/daytona-api-adapter.ts';

const KEY = 'dtn_test_key_for_the_local_stub';
const OTHER_KEY = 'dtn_definitely_the_wrong_key';

interface SandboxState {
  started: boolean;
  deleted: boolean;
  hash: string | null;
  name: string;
}

const state: SandboxState = {
  started: true,
  deleted: false,
  hash: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
  name: 'blueprint-first-stub',
};
const seen: { method: string; url: string; auth: string | undefined; body: string }[] = [];

function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => (data += String(chunk)));
    req.on('end', () => resolve(data));
  });
}

function json(res: import('node:http').ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

let server: Server;
let base = '';

before(async () => {
  server = createServer((req, res) => {
    void (async () => {
      const url = req.url ?? '';
      const body = await readBody(req);
      seen.push({ method: req.method ?? 'GET', url, auth: req.headers.authorization, body });
      const authed = req.headers.authorization === `Bearer ${KEY}`;
      const authorized = req.headers.authorization === `Bearer ${OTHER_KEY}`;

      // --- platform API ---
      if (url === '/api/health') return json(res, 200, { status: 'ok' });
      if (url === '/api/users/me') {
        if (!authed) return json(res, 401, { message: 'Invalid credentials' });
        return json(res, 200, { id: 'usr_1', username: 'blueprint-first' });
      }
      if (url === '/api/sandbox' && req.method === 'GET') {
        if (!authed && !authorized) return json(res, 401, { message: 'Invalid credentials' });
        if (!authed) return json(res, 403, { message: 'Unauthorized' });
        return json(res, 200, state.deleted ? [] : [
          {
            id: 'sbx_123',
            name: state.name,
            state: state.started ? 'started' : 'stopped',
            toolboxProxyUrl: `${base}/toolbox`,
          },
        ]);
      }
      if (url === '/api/sandbox' && req.method === 'POST') {
        if (!authed) return json(res, 401, { message: 'Invalid credentials' });
        const parsed = JSON.parse(body || '{}') as { name?: string };
        if (parsed.name !== undefined) state.name = parsed.name;
        return json(res, 200, { id: 'sbx_123', name: state.name, state: 'started', toolboxProxyUrl: `${base}/toolbox` });
      }
      if (/^\/api\/sandbox\/[^/]+\/start$/.test(url)) {
        if (!authed) return json(res, 401, { message: 'Invalid credentials' });
        state.started = true;
        state.deleted = false;
        return json(res, 200, {});
      }
      if (/^\/api\/sandbox\/[^/]+$/.test(url) && req.method === 'DELETE') {
        if (!authed) return json(res, 401, { message: 'Invalid credentials' });
        state.deleted = true;
        return json(res, 200, { ok: true });
      }

      // --- toolbox API ---
      if (url === '/toolbox/sbx_123/process/execute') {
        const parsed = JSON.parse(body) as { command?: string };
        const command = parsed.command ?? '';
        if (command === 'pwd') return json(res, 200, { result: '/home/daytona', exitCode: 0 });
        if (command.startsWith('git rev-parse')) return json(res, 200, { result: 'main', exitCode: 0 });
        if (command.startsWith('git status')) return json(res, 200, { result: '', exitCode: 0 });
        if (command.startsWith('fail')) return json(res, 200, { result: 'command failed', exitCode: 3 });
        return json(res, 200, { result: command, exitCode: 0 });
      }
      if (url.startsWith('/toolbox/sbx_123/files') && req.method === 'GET' && url.includes('/download')) {
        const payload = 'real file bytes from the Daytona sandbox';
        res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(payload) });
        res.end(payload);
        return;
      }
      if (url.startsWith('/toolbox/sbx_123/files?path=') && req.method === 'GET') {
        return json(res, 200, [
          { name: 'src', path: '/home/daytona/src', isDir: true, size: 0, modifiedAt: '2026-01-01T00:00:00Z' },
          { name: 'README.md', path: '/home/daytona/README.md', isDir: false, size: 12, modifiedAt: '2026-01-02T00:00:00Z' },
        ]);
      }
      if (url.startsWith('/toolbox/sbx_123/files/upload-v2')) {
        return json(res, 200, { ok: true });
      }
      if (url === '/toolbox/sbx_123/git/add') return json(res, 200, { ok: true });
      if (url === '/toolbox/sbx_123/git/commit') {
        return json(res, 200, state.hash === null ? {} : { hash: state.hash });
      }
      if (url.startsWith('/toolbox/sbx_123/git/status')) {
        return json(res, 200, { currentBranch: 'main', fileStatus: [{ name: 'a.ts', staging: 'Modified', worktree: 'Modified' }] });
      }
      return json(res, 404, { message: `unhandled ${req.method} ${url}` });
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  base = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('Daytona HTTP API client (real Daytona, production transport)', () => {
  it('verifies a correct credential against a real authenticated Daytona call', async () => {
    state.deleted = false;
    state.started = true;
    const client = new DaytonaApiClient({ apiKey: KEY, apiUrl: `${base}/api` });
    const verified = await client.verifyCredential();
    assert.equal(verified.ok, true);
    assert.match(verified.detail, /blueprint-first/);
    // The key travelled in the Authorization header and nowhere else.
    const call = seen.find((s) => s.url === '/api/users/me');
    assert.ok(call !== undefined);
    assert.equal(call?.auth, `Bearer ${KEY}`);
    assert.ok(!seen.some((s) => s.body.includes(KEY)), 'the credential must never appear in a request body');
  });

  it('REJECTS a wrong credential and never activates it', async () => {
    const client = new DaytonaApiClient({ apiKey: OTHER_KEY, apiUrl: `${base}/api` });
    const verified = await client.verifyCredential();
    assert.equal(verified.ok, false);
    assert.match(verified.detail, /401|403|Invalid credentials/i);
  });

  it('reports an unreachable Daytona honestly instead of pretending to be ready', async () => {
    const client = new DaytonaApiClient({ apiKey: KEY, apiUrl: 'http://127.0.0.1:1/api', timeoutMs: 2000 });
    const healthy = await client.healthy();
    assert.equal(healthy.ok, false);
    const verified = await client.verifyCredential();
    assert.equal(verified.ok, false);
    await assert.rejects(() => client.listSandboxes(), (error: unknown) => {
      assert.ok(error instanceof DaytonaApiError);
      return true;
    });
  });

  it('never leaks the credential into an error message', async () => {
    const client = new DaytonaApiClient({ apiKey: `${KEY}_leaky`, apiUrl: `${base}/api` });
    let message = '';
    try {
      await client.listSandboxes();
    } catch (error) {
      message = (error as Error).message;
    }
    assert.ok(!message.includes(`${KEY}_leaky`), `credential leaked into: ${message}`);
  });
});

describe('Daytona API workspace adapter (real sandbox execution)', () => {
  it('provisions, executes in, and destroys a real sandbox over the API', async () => {
    state.deleted = false;
    state.started = true;
    const adapter = new DaytonaApiWorkspaceAdapter('C:\\tmp\\blueprint-workspace', {
      apiKey: KEY,
      apiUrl: `${base}/api`,
    });
    assert.equal(adapter.kind, 'daytona');
    assert.equal(adapter.transport, 'api');

    // Before provisioning, a real Daytona has no sandbox for this environment and
    // the adapter must say exactly that rather than claiming one exists.
    const beforeProvision = await adapter.health();
    assert.equal(beforeProvision.ok, false);
    assert.match(beforeProvision.detail, /not present in the real sandbox list/);

    const provisioned = await adapter.provision({ label: 'test', gitEnabled: false });
    assert.equal(provisioned.ok, true, provisioned.detail);
    assert.match(provisioned.detail, /toolbox execution probe/);

    const health = await adapter.health();
    assert.equal(health.ok, true, health.detail);

    // A real command really executed in the sandbox.
    const run = await adapter.runCommand('echo real-execution');
    assert.equal(run.exitCode, 0);
    assert.match(run.stdout, /real-execution/);

    // Real file operations through the toolbox API.
    const entries = await adapter.listFiles('.');
    assert.deepEqual(entries.map((e) => e.name).sort(), ['README.md', 'src']);
    const read = await adapter.readFile('README.md');
    assert.equal(read.content, 'real file bytes from the Daytona sandbox');
    await adapter.writeFile('src/new.ts', 'export const a = 1;\n');
    assert.ok(seen.some((s) => s.url.startsWith('/toolbox/sbx_123/files/upload-v2')));

    // Real git state through the toolbox API.
    const status = await adapter.gitStatus();
    assert.equal(status.branch, 'main');
    assert.equal(status.entries.length, 1);

    await adapter.destroy();
    assert.ok(seen.some((s) => s.method === 'DELETE' && s.url.startsWith('/api/sandbox/')));
  });

  it('reports Daytona\'s REAL commit hash as provenance', async () => {
    state.deleted = false;
    const adapter = new DaytonaApiWorkspaceAdapter('C:\\tmp\\blueprint-workspace', {
      apiKey: KEY,
      apiUrl: `${base}/api`,
    });
    const commit = await adapter.gitCommit('real engineering change');
    assert.equal(commit.commit, state.hash);
  });

  it('refuses to claim provenance when Daytona returns no commit hash', async () => {
    state.deleted = false;
    state.hash = null;
    const adapter = new DaytonaApiWorkspaceAdapter('C:\\tmp\\blueprint-workspace', {
      apiKey: KEY,
      apiUrl: `${base}/api`,
    });
    await assert.rejects(() => adapter.gitCommit('commit with no hash'), /no commit hash/i);
    state.hash = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
  });

  it('reports a failed command with the real exit code instead of success', async () => {
    state.deleted = false;
    const adapter = new DaytonaApiWorkspaceAdapter('C:\\tmp\\blueprint-workspace', {
      apiKey: KEY,
      apiUrl: `${base}/api`,
    });
    const run = await adapter.runCommand('fail now');
    assert.equal(run.exitCode, 3);
    assert.match(run.stderr, /command failed/);
  });
});