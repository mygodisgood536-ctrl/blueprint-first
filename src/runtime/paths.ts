/**
 * Runtime data-directory resolution.
 *
 * Everything that must survive a restart lives in the durable backend (Neon in
 * production, filesystem snapshots in development). The data directory holds
 * only DERIVED state that the platform can rebuild: local workspace roots for
 * the development execution backend, control-plane probe records, the OpenCode
 * scratch project, and the slot NAMES the durable stores are addressed by.
 *
 * That distinction matters on a managed control plane, where the function
 * filesystem is read-only: the default repository directory cannot be created
 * there, and a boot that fails to mkdir is a boot that serves nothing. The
 * directory is therefore resolved to a writable location, and the platform
 * REPORTS when it had to fall back rather than pretending the original path was
 * used.
 *
 * Resolution order: explicit argument > BF_DATA_DIR env > a writable data root.
 */

import { promises as fs, constants as fsConstants } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function resolveDataDir(explicit?: string): string {
  const fromArg = explicit?.trim();
  if (fromArg !== undefined && fromArg.length > 0) return path.resolve(fromArg);
  const fromEnv = process.env['BF_DATA_DIR']?.trim();
  if (fromEnv !== undefined && fromEnv.length > 0) return path.resolve(fromEnv);
  // src/runtime/paths.ts -> repo root is two levels up.
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');
}

/**
 * Ensures a usable data directory and returns the one that is actually
 * writable.
 *
 * On a read-only filesystem (a serverless function's bundle) the requested
 * directory cannot exist, so a writable temporary root is used instead. The
 * caller is told whether that happened so it can report it honestly: the
 * durable state is unaffected either way, because it lives in the database.
 */
export async function ensureWritableDir(dir: string): Promise<{ dir: string; fellBack: boolean }> {
  const writable = async (candidate: string): Promise<boolean> => {
    try {
      await fs.mkdir(candidate, { recursive: true });
      await fs.access(candidate, fsConstants.W_OK);
      return true;
    } catch {
      return false;
    }
  };
  if (await writable(dir)) return { dir, fellBack: false };
  const fallback = path.join(tmpdir(), 'blueprint-first-data');
  await fs.mkdir(fallback, { recursive: true });
  return { dir: fallback, fellBack: true };
}

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}
