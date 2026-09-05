import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProviderManager } from '../src/ai/provider-manager.ts';
import { buildServer } from '../src/web/server.ts';
import { runDemoPipeline } from '../src/demo/main.ts';
import { consoleSink, createLogger } from '../src/core/logging.ts';

let pass = 0, fail = 0;
const ok = (n, c, d = '') => c ? (pass++, console.log('  OK   ' + n)) : (fail++, console.log('  FAIL ' + n + (d ? ' — ' + d : '')));

const logger = createLogger({ level: 'warn', sink: consoleSink() });
const result = await runDemoPipeline(logger);
const dataDir = mkdtempSync(join(tmpdir(), 'nexona-smoke-'));
const pm = new ProviderManager();
const { app } = await buildServer({ result, providerManager: pm, dataDir });
const server = app.listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const paths = [
  '/',
  '/nexona/index.html',
  '/nexona/css/tokens.css', '/nexona/css/layout.css', '/nexona/css/components.css',
  '/nexona/js/app.js', '/nexona/js/router.js', '/nexona/js/api.js',
  '/nexona/js/views/dashboard.js', '/nexona/js/views/settings-preferences.js',
  '/nexona/js/views/settings-profile.js', '/nexona/js/ui/toast.js',
  '/nexona/img/logo-icon.svg',
];

for (const p of paths) {
  const r = await fetch(BASE + p);
  const ct = r.headers.get('content-type') || '';
  ok(`GET ${p} (${r.status}, ${ct.split(';')[0]})`, r.status === 200, `status=${r.status}`);
}

// Root serves the SPA shell (hash routing: browser always requests '/')
const rootHtml = await (await fetch(BASE + '/')).text();
ok('root serves SPA shell', rootHtml.includes('<div id="app"') && rootHtml.includes('app.js'));

// API 401 for unprotected
const noauth = await fetch(BASE + '/api/me');
ok('GET /api/me unauthenticated -> 200 {account:null}', noauth.status === 200);

server.close();
rmSync(dataDir, { recursive: true, force: true });
console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
