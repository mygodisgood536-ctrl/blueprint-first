/**
 * Independence enforcement - the structural guarantee that no actor can
 * certify its own work.
 *
 * Architecture rule implemented here:
 *   WORKER -> SELF-VERIFICATION (non-certifying) -> SPECIALIST VERIFIER ->
 *   BOSS -> INDEPENDENT AUDIT -> CERTIFICATION
 *
 * Identity rule: two actors are "the same" when their ids match, regardless
 * of declared kind - an account re-labeled as a verifier is still the same
 * origin. Self-verification is allowed as a non-certifying first pass but can
 * never satisfy the specialist/boss/audit/certification roles.
 */

import { SelfCertificationError } from '../core/errors.ts';
import type { Actor } from '../core/artifact.ts';
import type { VerificationReport } from './verifier.ts';
import { summarizeReport } from './verifier.ts';

/** Same origin? Ids match regardless of kind. */
export function sameActorIdentity(a: Actor, b: Actor): boolean {
  return a.id === b.id;
}

/**
 * Throws unless verifier is a different origin than producer.
 * Call this BEFORE running specialist verification / boss decisions so a
 * self-certifying flow fails fast instead of producing untrustworthy reports.
 */
export function assertIndependentVerifier(producer: Actor, verifier: Actor): void {
  if (sameActorIdentity(producer, verifier)) {
    throw new SelfCertificationError(
      `Actor "${producer.id}" produced the work and cannot also act as its independent verifier.`,
    );
  }
}

export interface CertificationDecision {
  certifiable: boolean;
  reasons: string[];
}

/**
 * Foundation-level certification gate.
 *
 * Work is certifiable only when ALL of the following hold:
 *   1. The verifier is a different origin than the producing actor.
 *   2. The verifier's declared kind is 'verifier' or 'system'.
 *   3. The report covers all eleven verification dimensions.
 *   4. No dimension carries a 'fail' verdict.
 *
 * NOTE: this is the Level-1a gate. Full Blueprint Completeness Certification
 * (Level 2) will extend this with blueprint-specific completeness rules on
 * top of the same primitives - this function is designed to be reused there.
 */
export function certificationDecision(
  report: VerificationReport,
  producerActor: Actor,
): CertificationDecision {
  const summary = summarizeReport(report);
  const reasons: string[] = [];
  if (sameActorIdentity(producerActor, report.verifier)) {
    reasons.push(`Verifier "${report.verifier.id}" is the same origin as the producer.`);
  }
  if (report.verifier.kind !== 'verifier' && report.verifier.kind !== 'system') {
    reasons.push(
      `Verifier kind "${report.verifier.kind}" may not certify; expected kind 'verifier' or 'system'.`,
    );
  }
  if (!summary.coversAllEleven) {
    reasons.push(
      `Report does not cover all eleven dimensions; missing: ${summary.missingDimensions.join(', ')}.`,
    );
  }
  if (summary.hasBlockingFailure) {
    reasons.push(`Report contains ${summary.failed} failing finding(s).`);
  }
  return { certifiable: reasons.length === 0, reasons };
}
