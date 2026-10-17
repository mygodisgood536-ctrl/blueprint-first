/**
 * Mojibake repair (per-run, self-verifying).
 *
 * A previous bulk edit round-tripped UTF-8 through a Windows code page, so
 * characters such as an em dash or a copyright sign were stored as their
 * misinterpreted byte pairs ("â€”", "Â©"). Some files were corrupted twice,
 * producing "Ã‚Â§" for one section sign.
 *
 * Reversal is applied to individual short runs of suspect bytes rather than to
 * the whole file, so correctly-encoded text (including characters above U+00FF
 * such as emoji) is never touched. Each run is only accepted when it decodes to
 * valid UTF-8 and yields fewer mojibake markers than it started with. Passes
 * repeat until a file stops improving, which is what unwraps double encoding.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = 'design-prototype/src';

/** Bytes 0x80-0x9F are not the same code points in cp1252 as in latin1 (0x82
 *  becomes U+201A, for example), so the range that a damaged run can occupy
 *  includes the cp1252 punctuation block as well. */
const CP1252_HIGH = '\\u2013\\u2014\\u2018\\u2019\\u201A\\u201C\\u201D\\u201E\\u2020\\u2021\\u2022\\u2026\\u2030\\u2039\\u203A\\u0192\\u02C6\\u02DC\\u0153\\u0178\\u017D\\u017E\\u20AC\\u2122';
const TAIL = `(?:[\\u0080-\\u00BF]|[\\u00A0-\\u00FF]|[${CP1252_HIGH}]){1,2}`;

/** A run of one to three damaged characters beginning with a classic
 *  UTF-8-as-latin1 lead byte. */
const RUN = new RegExp(
  `[\\u00C2\\u00C3\\u00E2\\u00E3\\u00F0\\u00EF\\u00F4\\u00F9]${TAIL}`,
  'g',
);

const MARKER = new RegExp(
  `[\\u00C2\\u00C3\\u00E2\\u00E3\\u00F0\\u00EF\\u00F4\\u00F9](?:[\\u0080-\\u00BF]|[\\u00A0-\\u00FF]|[${CP1252_HIGH}])`,
  'g',
);

const score = (text) => (text.match(MARKER) ?? []).length;

/** The cp1252 characters that occupy byte values 0x80-0x9F, mapped back to the
 *  byte each one stands for, so a damaged run can be turned into real bytes. */
const cp1252Reverse = new Map(
  Object.entries({
    '\u20AC': 0x80, '\u201A': 0x82, '\u0192': 0x83, '\u201E': 0x84, '\u2026': 0x85,
    '\u2020': 0x86, '\u2021': 0x87, '\u02C6': 0x88, '\u2030': 0x89, '\u0160': 0x8a,
    '\u2039': 0x8b, '\u0152': 0x8c, '\u017D': 0x8e, '\u2018': 0x91, '\u2019': 0x92,
    '\u201C': 0x93, '\u201D': 0x94, '\u2022': 0x95, '\u2013': 0x96, '\u2014': 0x97,
    '\u02DC': 0x98, '\u2122': 0x99, '\u0161': 0x9a, '\u203A': 0x9b, '\u0153': 0x9c,
    '\u017E': 0x9e, '\u0178': 0x9f,
  }),
);

function repairOnce(text) {
  let changed = false;
  const out = text.replace(RUN, (run) => {
    // A damaged run is the low bytes of a UTF-8 sequence; recover them by
    // encoding each code point back to its cp1252/latin1 byte first.
    const bytes = Buffer.from(
      [...run].map((c) => {
        const b = cp1252Reverse.get(c);
        return b === undefined ? c.charCodeAt(0) : b;
      }),
    );
    const decoded = bytes.toString('utf8');
    // Reject anything that did not decode cleanly, and only accept a run when
    // it genuinely reduces the number of suspect sequences.
    if (decoded.includes('\uFFFD')) return run;
    if (score(decoded) >= score(run)) return run;
    changed = true;
    return decoded;
  });
  return changed ? out : null;
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.tsx?$/.test(entry)) yield full;
  }
}

let fixedFiles = 0;
let repaired = 0;
for (const file of walk(ROOT)) {
  const original = readFileSync(file, 'utf8');
  const start = score(original);
  if (start === 0) continue;

  let text = original;
  let before = start;
  for (let pass = 0; pass < 6 && before > 0; pass += 1) {
    const next = repairOnce(text);
    if (next === null) break;
    const after = score(next);
    if (after >= before) break;
    text = next;
    repaired += before - after;
    before = after;
  }

  if (text !== original) {
    writeFileSync(file, text);
    fixedFiles += 1;
    console.log(
      `${String(start).padStart(3)} -> ${String(score(text)).padStart(3)}  ${relative('.', file)}`,
    );
  }
}
console.log(`\n${repaired} marker(s) repaired across ${fixedFiles} file(s).`);