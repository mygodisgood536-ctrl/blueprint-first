/**
 * Host PATH reconciliation (ARCHITECTURE 3.3 - the platform must go READY the
 * moment a mandatory component is installed, with no restart and no
 * architectural rewrite).
 *
 * A long-running service inherits its PATH when it starts. When a CLI is
 * installed afterwards, the installer writes to the *user/machine* PATH
 * registry, but the already-running process - and every child it spawns - keeps
 * the stale environment block it was born with. That is exactly how a platform
 * ends up reporting "NOT_INSTALLED" for a tool that is genuinely installed.
 *
 * `reconcileHostPath()` merges the current machine and user PATH from the
 * registry into this process's environment, preserving any entries that are
 * only in the live environment (e.g. injected test paths). It is additive and
 * idempotent: already-present entries are not duplicated, and nothing is ever
 * removed.
 *
 * This is not a simulation and not a convenience: without it, a real Daytona
 * or Cline installation performed after boot is genuinely invisible to the
 * capability probes, the execution gateway and the environment adapters.
 */

import { execFileSync } from 'node:child_process';

/**
 * Reads a PATH value from the registry. Uses `reg.exe` rather than spawning
 * PowerShell: PowerShell startup is orders of magnitude slower (measured
 * ~14s/binaries on hosts with aggressive AV scanning, vs ~2s for reg.exe) and
 * this runs on every server boot. The read is cached per process so a single
 * long-running server or a test that boots many servers probes the registry
 * once. `resetHostPathCache()` forces a fresh read (used before a forced
 * foundation re-probe so a live CLI install is still seen without a restart).
 */
const registryCache = new Map<string, string[]>();

/** Clears the cached registry PATH reads (see module docs). */
export function resetHostPathCache(): void {
  registryCache.clear();
}

const REGISTERED_PATH_KEYS: Record<'machine' | 'user', string> = {
  machine: 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment',
  user: 'HKCU\\Environment',
};

function expandEnv(value: string): string {
  return value.replace(/%([^%]+)%/g, (_m, name: string) => {
    return process.env[name] ?? process.env[name.toUpperCase()] ?? `%${name}%`;
  });
}

function registryPath(scope: 'machine' | 'user'): string[] {
  if (process.platform !== 'win32') return [];
  const cached = registryCache.get(scope);
  if (cached !== undefined) return cached;
  const key = REGISTERED_PATH_KEYS[scope];
  try {
    const out = execFileSync('reg.exe', ['query', key, '/v', 'Path'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const match = /^\s+Path\s+REG_(?:EXPAND_)?SZ\s+(.+)$/m.exec(out);
    const raw = match?.[1] ?? '';
    const entries =
      raw === ''
        ? []
        : expandEnv(raw)
            .split(';')
            .map((entry) => entry.trim().replace(/^"|"$/g, ''))
            .filter((entry) => entry.length > 0);
    registryCache.set(scope, entries);
    return entries;
  } catch {
    registryCache.set(scope, []);
    return [];
  }
}

function normalise(entry: string): string {
  const trimmed = entry.replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? trimmed.toLowerCase() : trimmed;
}

/**
 * Merges the machine + user PATH registries into this process's PATH.
 * Returns the entries that were actually added (for honest evidence).
 */
export function reconcileHostPath(): string[] {
  const key = 'PATH';
  const live = (process.env[key] ?? '').split(';').map((e) => e.trim()).filter((e) => e.length > 0);
  const seen = new Set(live.map(normalise));
  const added: string[] = [];
  for (const entry of [...registryPath('machine'), ...registryPath('user')]) {
    const norm = normalise(entry);
    if (seen.has(norm)) continue;
    seen.add(norm);
    added.push(entry);
  }
  if (added.length > 0) {
    process.env[key] = [...live, ...added].join(';');
  }
  return added;
}
