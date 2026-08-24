/** Structural validation of the nested `pages` collection. */

import type { Obj } from './parse-util.ts';
import { isObj, needString } from './parse-util.ts';
import type { RawPage } from './types.ts';

export function collectPages(value: Obj, problems: string[]): RawPage[] {
  if (value['pages'] === undefined) return [];
  if (!Array.isArray(value['pages'])) {
    problems.push('pages: must be an array when present.');
    return [];
  }
  const pages: RawPage[] = [];
  value['pages'].forEach((p, i) => {
    const label = `pages[${i}]`;
    if (!isObj(p)) {
      problems.push(`${label}: must be an object.`);
      return;
    }
    for (const f of ['key', 'moduleKey', 'title', 'purpose'] as const) {
      needString(p, f, label, problems);
    }
    for (const coll of ['sections', 'actions', 'states', 'validations'] as const) {
      if (p[coll] !== undefined && !Array.isArray(p[coll])) {
        problems.push(`${label}.${coll}: must be an array when present.`);
      }
    }
    ((p['sections'] as unknown[] | undefined) ?? []).forEach((s, j) => {
      const sl = `${label}.sections[${j}]`;
      if (!isObj(s)) return void problems.push(`${sl}: must be an object.`);
      needString(s, 'key', sl, problems);
      needString(s, 'title', sl, problems);
      needString(s, 'contentType', sl, problems);
    });
    ((p['actions'] as unknown[] | undefined) ?? []).forEach((a, j) => {
      const al = `${label}.actions[${j}]`;
      if (!isObj(a)) return void problems.push(`${al}: must be an object.`);
      needString(a, 'key', al, problems);
      needString(a, 'title', al, problems);
      needString(a, 'outcome', al, problems);
    });
    ((p['states'] as unknown[] | undefined) ?? []).forEach((s, j) => {
      const stl = `${label}.states[${j}]`;
      if (!isObj(s)) return void problems.push(`${stl}: must be an object.`);
      needString(s, 'key', stl, problems);
      needString(s, 'name', stl, problems);
      needString(s, 'whenVisible', stl, problems);
    });
    ((p['validations'] as unknown[] | undefined) ?? []).forEach((v, j) => {
      const vl = `${label}.validations[${j}]`;
      if (!isObj(v)) return void problems.push(`${vl}: must be an object.`);
      needString(v, 'targetKey', vl, problems);
      needString(v, 'message', vl, problems);
    });
    pages.push(p as unknown as RawPage);
  });
  return pages;
}
