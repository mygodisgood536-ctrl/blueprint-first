/**
 * Discovery-specific error types.
 *
 * AI responses that fail structural validation never become artifacts; they
 * are rejected with these typed errors carrying precise, human-readable
 * reasons (spec: handle malformed/incomplete/duplicated/contradictory output
 * explicitly).
 */

import { BlueprintError } from '../core/errors.ts';

/** The AI response was not parseable into the discovery schema. */
export class DiscoveryParseError extends BlueprintError {
  constructor(reasons: readonly string[]) {
    super(
      'DISCOVERY_PARSE_FAILED',
      `Discovery response does not match the required schema:\n- ${reasons.join('\n- ')}`,
    );
  }
}

/**
 * The response parsed but failed semantic normalization: duplicate keys,
 * dangling references, empty required text, invalid slugs, contradictions.
 */
export class DiscoveryValidationError extends BlueprintError {
  constructor(reasons: readonly string[]) {
    super(
      'DISCOVERY_VALIDATION_FAILED',
      `Discovery response failed semantic validation:\n- ${reasons.join('\n- ')}`,
    );
  }
}

export interface BriefValidationIssue {
  field: string;
  problem: string;
}

/** The Product Understanding Brief itself was unusable. */
export class InvalidBriefError extends BlueprintError {
  readonly issues: readonly BriefValidationIssue[];
  constructor(issues: readonly BriefValidationIssue[]) {
    super(
      'INVALID_BRIEF',
      `Product Understanding Brief is invalid:\n- ${issues.map((i) => `${i.field}: ${i.problem}`).join('\n- ')}`,
    );
    this.issues = issues;
  }
}
