/**
 * Build/serve wiring: after `vite build`, replace the compiled SPA served from
 * `src/web/public/nexona` with the freshly-built design-prototype output so the
 * deployed bundle always reflects the real frontend source. Kept as a tiny,
 * dependency-free Node script so the platform repo never needs a design-tool
 * install.
 */

import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, '..', 'dist');
const target = join(here, '..', '..', 'src', 'web', 'public', 'nexona');

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(dist, target, { recursive: true });
const files = await readdir(target, { recursive: true });
console.log(`[nexona] copied ${files.length} file(s) from design-prototype/dist to src/web/public/nexona`);