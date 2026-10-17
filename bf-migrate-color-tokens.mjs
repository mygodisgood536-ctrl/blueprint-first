/**
 * One-off migration: colour tokens are stored as space-separated triplets so
 * that CSS can compose them with an alpha channel, e.g.
 *
 *     background: rgb(var(--surface) / 0.5);
 *
 * A number of existing screens used to reference those tokens directly:
 *
 *     style={{ background: 'var(--surface)' }}
 *
 * which resolves to the literal string "255 255 255" and is therefore not a
 * valid colour - the declaration is dropped and the element silently falls back.
 *
 * This wraps the direct references in rgb() so they resolve. Non-colour tokens
 * (font stacks, radii, transitions) are deliberately left alone.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = 'design-prototype/src';

// Longest names first so --surface-hover is never truncated to --surface.
const COLOUR_TOKENS = [
  'bg-elevated', 'surface-hover', 'surface-2', 'fg-muted', 'fg-subtle',
  'accent-bright', 'success-ink', 'danger-ink', 'warning-ink', 'info-ink',
  'accent-ink', 'teal-bright', 'bg', 'surface', 'fg', 'accent', 'teal',
  'line', 'danger', 'success', 'warning', 'info',
];
const NAMES = COLOUR_TOKENS.join('|');
// (?<!rgb\() guards against double-wrapping an already-correct reference.
const PATTERN = new RegExp(`(?<!rgb\\()var\\(--(${NAMES})\\)`, 'g');

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.tsx?$/.test(entry)) yield full;
  }
}

let changedFiles = 0;
let changedRefs = 0;
for (const file of walk(ROOT)) {
  const before = readFileSync(file, 'utf8');
  const matches = before.match(PATTERN);
  if (!matches) continue;
  const after = before.replace(PATTERN, (_m, name) => `rgb(var(--${name}))`);
  writeFileSync(file, after);
  changedFiles += 1;
  changedRefs += matches.length;
  console.log(`${String(matches.length).padStart(3)}  ${relative('.', file)}`);
}
console.log(`\n${changedRefs} reference(s) fixed across ${changedFiles} file(s).`);