/**
 * Runtime data-directory resolution.
 *
 * Everything that must survive a restart lives under one directory:
 *   data/accounts.json             durable account/session registry
 *   data/projects/index.json       project index (Phase 2)
 *   data/projects/<id>.json        per-project artifact stores (Phase 2/3)
 *
 * Resolution order: explicit argument > BF_DATA_DIR env > <repo>/data.
 */

import { promises as fs } from 'node:fs';
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

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}