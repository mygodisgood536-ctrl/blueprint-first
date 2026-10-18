/**
 * Filesystem durable-snapshot backend (development and tests).
 *
 * Real, durable state on the local disk — never a simulation — but explicitly
 * single-node. It is never selected in production: `selectStorageKind` chooses
 * PostgreSQL whenever a connection string is present, and `BF_REQUIRE_DATABASE`
 * makes the absence of one a hard boot failure rather than a quiet downgrade.
 */

import { join, dirname, basename, extname, resolve } from 'node:path';
import { promises as fs } from 'node:fs';
import { atomicWriteText } from '../core/json-file-store.ts';
import type { DurableSnapshotBackend, StorageKind } from './backend.ts';

export function jsonFileBackend(rootDir: string): DurableSnapshotBackend {
  const root = resolve(rootDir);
  const queues = new Map<string, Promise<unknown>>();

  const pathFor = (key: string): string => {
    const safe = key.replace(/[^A-Za-z0-9._-]/g, '_');
    return join(root, `${safe}.snapshot.json`);
  };

  const enqueue = <T>(key: string, run: () => Promise<T>): Promise<T> => {
    const previous = queues.get(key) ?? Promise.resolve();
    const chained = previous.then(run, run);
    queues.set(
      key,
      chained.catch(() => undefined),
    );
    return chained;
  };

  return {
    kind: 'json-file' satisfies StorageKind,
    /** The filesystem backend is the one backend with a real location. */
    location: (key: string): string | null => pathFor(key),

    async read(key: string): Promise<unknown | null> {
      const file = pathFor(key);
      let raw: string;
      try {
        raw = await fs.readFile(file, 'utf8');
      } catch {
        return null;
      }
      if (raw.length > 0 && /^[\0\s]+$/.test(raw)) return null; // interrupted first write
      const parsed = JSON.parse(raw) as { value?: unknown };
      return 'value' in parsed ? parsed.value : null;
    },

    async write(key: string, value: unknown): Promise<void> {
      await enqueue(key, () =>
        atomicWriteText(pathFor(key), JSON.stringify({ savedAt: new Date().toISOString(), value }, null, 2)),
      );
    },

    async transact<T>(
      key: string,
      mutate: (current: unknown | null) => Promise<{ value: unknown | null; result: T }> | { value: unknown | null; result: T },
    ): Promise<T> {
      return enqueue(key, async () => {
        let current: unknown | null = null;
        try {
          const raw = await fs.readFile(pathFor(key), 'utf8');
          if (!(raw.length > 0 && /^[\0\s]+$/.test(raw))) {
            const parsed = JSON.parse(raw) as { value?: unknown };
            current = 'value' in parsed ? parsed.value : null;
          }
        } catch {
          current = null;
        }
        const { value, result } = await mutate(current);
        if (value !== null) {
          await atomicWriteText(
            pathFor(key),
            JSON.stringify({ savedAt: new Date().toISOString(), value }, null, 2),
          );
        }
        return result;
      });
    },

    async close(): Promise<void> {
      /* nothing pooled */
    },
  };
}

/** Filesystem path a slot occupies (diagnostics and operator tooling only). */
export function snapshotPathFor(rootDir: string, key: string): string {
  const safe = key.replace(/[^A-Za-z0-9._-]/g, '_');
  return join(resolve(rootDir), `${safe}.snapshot.json`);
}

/** Derives a stable slot name from a legacy absolute file path. */
export function slotNameFromFilePath(filePath: string): string {
  const name = basename(filePath, extname(filePath));
  return dirname(filePath).length > 0 ? name : name;
}