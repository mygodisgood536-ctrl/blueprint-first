/** Product Understanding Brief validation (spec §0.3 DW-A1 inputs). */

import type { ProductUnderstandingBrief } from './types.ts';
import { InvalidBriefError } from './errors.ts';

export function validateBrief(brief: ProductUnderstandingBrief): void {
  const issues: { field: string; problem: string }[] = [];
  if (typeof brief.name !== 'string' || brief.name.trim() === '') {
    issues.push({ field: 'name', problem: 'required non-empty string' });
  }
  if (typeof brief.vision !== 'string' || brief.vision.trim().length < 10) {
    issues.push({
      field: 'vision',
      problem: 'required non-empty string of at least 10 characters',
    });
  }
  if (
    !Array.isArray(brief.targetUsers) ||
    brief.targetUsers.length === 0 ||
    !brief.targetUsers.every((u) => typeof u === 'string' && u.trim() !== '')
  ) {
    issues.push({
      field: 'targetUsers',
      problem: 'required non-empty array of non-empty strings',
    });
  }
  if (
    brief.constraints !== undefined &&
    (!Array.isArray(brief.constraints) ||
      !brief.constraints.every((c) => typeof c === 'string'))
  ) {
    issues.push({ field: 'constraints', problem: 'must be an array of strings when present' });
  }
  if (issues.length > 0) throw new InvalidBriefError(issues);
}
