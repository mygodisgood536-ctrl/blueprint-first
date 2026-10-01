/**
 * Real CODE stub `daytona` CLI for the environment tests.
 *
 * The border the tests care about is REAL: a genuine `daytona.cmd` on the host
 * PATH (or a real executable name) resolved by the platform's own cmd-shell
 * primitive. The stub is a .cmd that calls a node script implementing a
 * minimal, honest Daytona surface (create/list/delete/exec + git + file ops +
 * --version). Nothing is mocked in-process; argv construction, quoting,
 * parsing and failure behaviour of the real adapter boundary is under test.
 */
import { join } from 'node:path';
import { promises as fs } from 'node:fs';

export const STUB_CLI = `@echo off
node "%~dp0stub-daytona.js" %*
`;

export const STUB_IMPL = `
const fs = require('node:fs');
const path = require('node:path');
const stateFile = path.join(__dirname, 'daytona-state.json');
const WROOT = path.join(__dirname, 'workspaces');
function readState() {
  try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { return { workspaces: [] }; }
}
function writeState(s) { fs.mkdirSync(path.dirname(stateFile), { recursive: true }); fs.writeFileSync(stateFile, JSON.stringify(s)); }
function wsDir(name) { const d = path.join(WROOT, name); fs.mkdirSync(d, { recursive: true }); return d; }
function argv() { return process.argv.slice(2); }
function main() {
  const a = argv();
  const cmd = a[0];
  const nameOf = (flag) => { const i = a.indexOf(flag); return i !== -1 ? a[i + 1] : ''; };
  const state = readState();
  // Real CLI surface (daytona v0.190.0): --version prints "Daytona CLI version vX.Y.Z".
  if (cmd === '--version' || cmd === 'version') { process.stdout.write('Daytona CLI version v0.190.0-test\\n'); return; }
  if (cmd === 'create') { const n = nameOf('--name'); if (!state.workspaces.includes(n)) state.workspaces.push(n); writeState(state); process.stdout.write('sandbox created\\n'); return; }
  if (cmd === 'list') {
    // Real CLI: --format json prints a JSON array of sandbox objects.
    if (a.includes('--format') && a[a.indexOf('--format') + 1] === 'json') {
      process.stdout.write(JSON.stringify(state.workspaces.map((n) => ({ id: 'sbx-' + n, name: n, state: 'started' }))));
      return;
    }
    for (const n of state.workspaces) process.stdout.write(n + '\\trunning\\n');
    return;
  }
  // Real CLI: delete takes the sandbox id/name as a POSITIONAL argument (no --force).
  if (cmd === 'delete') {
    const n = a[1];
    if (!n || n.startsWith('-')) { process.exitCode = 1; process.stdout.write('sandbox id or name required\\n'); return; }
    state.workspaces = state.workspaces.filter((w) => w !== n);
    writeState(state);
    process.stdout.write('sandbox deleted\\n');
    return;
  }
  if (cmd === 'exec') {
    // Real CLI: exec <SANDBOX_ID|NAME> -- [COMMAND] [ARGS...] [--cwd <dir>] [--timeout <s>]
    const name = a[1];
    const dash = a.indexOf('--');
    const command = dash === -1 ? '' : a.slice(dash + 1).join(' ');
    const cwdIdx = a.indexOf('--cwd');
    const cwd = cwdIdx !== -1 ? a[cwdIdx + 1] : null;
    const root = wsDir(name || '');
    if (!name || !state.workspaces.includes(name)) { process.exitCode = 1; process.stdout.write('no such sandbox\\n'); return; }
    if (command.startsWith('pwd')) { process.stdout.write((cwd ? path.join(root, cwd) : root) + '\\n'); return; }
    if (command.startsWith('git init')) { process.stdout.write('Initialized empty Git repository in ' + root + '\\n'); return; }
    if (command.startsWith('git status --porcelain')) { process.stdout.write('## main\\n'); return; }
    if (command.startsWith('git rev-parse --abbrev-ref HEAD')) { process.stdout.write('main\\n'); return; }
    if (command.startsWith('git -c')) {
      if (command.includes(' commit ')) { process.stdout.write('[main 9b8a1c0] workspace committed\\n'); }
      return;
    }
    if (command.startsWith('ls -la')) {
      const parts = command.trim().split(/\\s+/);
      const rel = parts[parts.length - 1] === '.' ? '' : (parts[parts.length - 1] ?? '');
      const dir = rel === '' ? root : path.join(root, rel);
      let total = 0;
      const rows = [];
      try {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          const st = fs.statSync(full);
          total += 1;
          const isDir = entry.isDirectory();
          const mod = 'Jan 1 00:00';
          const mode = isDir ? 'drwxr-xr-x' : '-rw-r--r--';
          rows.push(mode + ' 1 root root ' + st.size + ' ' + mod + ' ' + entry.name);
        }
      } catch { rows.length = 0; }
      process.stdout.write('total ' + total + '\\n' + rows.join('\\n') + (rows.length ? '\\n' : ''));
      return;
    }
    if (command.startsWith('cat ')) {
      const target = path.join(root, command.slice(4).trim());
      try { process.stdout.write(fs.readFileSync(target, 'utf8')); } catch { process.stdout.write(''); }
      return;
    }
    const wm = command.match(/^(?:mkdir -p ([^ ]+) && )?echo ([A-Za-z0-9+/=]+) \\| base64 -d > (.+)$/);
    if (wm) {
      const target = path.join(root, wm[3]);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, Buffer.from(wm[2], 'base64'));
      return;
    }
    const mm = command.match(/^mkdir -p ([^ ]+) && mv ([^ ]+) ([^ ]+)$/);
    if (mm) {
      const from = path.join(root, mm[2]);
      const to = path.join(root, mm[3]);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.renameSync(from, to);
      return;
    }
    if (command.startsWith('rm -rf ')) { const target = path.join(root, command.slice(7).trim()); try { fs.rmSync(target, { recursive: true, force: true }); } catch { /* gone */ } return; }
    if (command.startsWith('echo ')) { process.stdout.write('[stub] ok\\n'); return; }
    process.stdout.write('\\n');
    return;
  }
  process.exitCode = 1;
}
main();
`;

/** Writes the stub `daytona.cmd` + implementation into `dir`; returns the .cmd path. */
export async function writeDaytonaStub(dir: string): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(join(dir, 'daytona.cmd'), `@echo off\nnode "%~dp0stub-daytona.js" %*\n`, 'utf8');
  await fs.writeFile(join(dir, 'stub-daytona.js'), STUB_IMPL, 'utf8');
  return join(dir, 'daytona.cmd');
}

/** Prepends `dir` to the current process PATH (real host resolution for child shells). */
export function prependToPath(dir: string): string {
  const original = process.env['PATH'] ?? '';
  process.env['PATH'] = `${dir};${original}`;
  return original;
}

/** Restores the pre-test PATH exactly. */
export function restorePath(original: string): void {
  process.env['PATH'] = original;
}