/**
 * Reproduces an authenticated endpoint failure with the server's own log, so the
 * cause is the reported exception rather than a guess.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { openSync } from 'node:fs';

const BASE = 'http://127.0.0.1:3115';
const LOG = `${process.env.TEMP}\\bf-lineage-server.log`;
const PATHS = process.argv.slice(2);
let server: ChildProcess | undefined;

async function main(): Promise<void> {
  const out = openSync(LOG, 'w');
  server = spawn(process.execPath, ['src/web/server.ts'], {
    env: { ...process.env, BF_DATA_DIR: `${process.env.TEMP}\\bf-lineage-data`, BF_BOOTSTRAP_SECURITY_ANSWER: 'Lagos', BF_WEB_PORT: '3115' },
    stdio: ['ignore', out, out],
  });
  for (let i = 0; i < 150; i += 1) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* wait */ }
    await delay(700);
  }

  const gmail = `lineage_${String(process.pid).slice(-5)}@gmail.com`;
  const answer = 'Answer From Memory';
  const questions = await (await fetch(`${BASE}/api/auth/security-questions`)).json() as { questions: string[] };
  const question = questions.questions[0]!;

  await fetch(`${BASE}/api/auth/signup`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fullName: 'Lineage Probe', username: `lg_${String(process.pid).slice(-5)}`, gmail, securityQuestion: question, securityAnswer: answer }),
  });
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ gmail, securityQuestion: question, securityAnswer: answer }),
  });
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]!.trim();
  console.log('signed in, cookie:', cookie.slice(0, 20) + '...');

  for (const path of PATHS.length > 0 ? PATHS : ['/api/lineage']) {
    const res = await fetch(`${BASE}${path}`, { headers: { cookie } });
    const text = await res.text();
    console.log(`\n${path} -> ${res.status}`);
    if (res.status >= 400) console.log('  body: ' + text.slice(0, 400));
  }

  await delay(600);
  server.kill();
  await delay(400);

  const { readFileSync } = await import('node:fs');
  const log = readFileSync(LOG, 'utf8');
  const lines = log.split(/\r?\n/).filter((l) => /error|Error|at |stack|throw/i.test(l));
  console.log('\n--- server log (errors) ---');
  console.log(lines.slice(-25).join('\n'));

  process.exit(0);
}
main().catch((e) => { console.error(e); server?.kill(); process.exit(1); });