/**
 * Reports every CSS class referenced by the screens that the design system does
 * not define. A missing class is invisible in a type check and in a production
 * build, but it silently drops layout and spacing at runtime.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = 'design-prototype/src';
const LAYERS = ['tokens.css', 'base.css', 'components.css', 'entry.css'];

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.tsx?$/.test(entry)) yield full;
  }
}

const css = LAYERS.map((f) => readFileSync(join(SRC, f), 'utf8')).join('\n');
const defined = new Set([...css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]));

/** Pull class names out of className="a b", className={'a b'}, `a ${x} b`. */
function classNames(text) {
  const out = [];
  for (const m of text.matchAll(/className\s*=\s*(?:"([^"]*)"|'([^']*)'|\{`([^`]*)`\})/g)) {
    const raw = (m[1] ?? m[2] ?? m[3] ?? '').replace(/\$\{[^}]*\}/g, ' ');
    for (const c of raw.split(/\s+/)) if (c) out.push(c);
  }
  return out;
}

/** Also catch bare string class lists passed to clsx-like helpers. */
function bareLists(text) {
  const out = [];
  for (const m of text.matchAll(/['"`]([a-z][a-z0-9]*(?:[- ][a-z0-9-]+)*)['"`]/g)) {
    const raw = m[1];
    if (!/^(m[btlxy]?|p[btlxy]?|gap|text|w|h|mt|mb|ml|mr|pt|pb|pl|pr)-/.test(raw)) continue;
    for (const c of raw.split(' ')) if (c) out.push(c);
  }
  return out;
}

const used = new Map();
const bump = (c) => used.set(c, (used.get(c) ?? 0) + 1);
for (const file of walk(SRC)) {
  const text = readFileSync(file, 'utf8');
  for (const c of [...classNames(text), ...bareLists(text)]) bump(c);
}

const missing = [...used.entries()]
  .filter(([c]) => !defined.has(c))
  .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

console.log(`classes used: ${used.size}   defined: ${defined.size}   MISSING: ${missing.length}`);
for (const [c, n] of missing) console.log(`  ${String(n).padStart(4)}  ${c}`);