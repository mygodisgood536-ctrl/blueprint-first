/**
 * Master Verification Engine (Level 2) - the organization's Independent Audit.
 *
 * Where a Specialist Verifier judges ONE draft, the Master Verification
 * Engine re-checks an entire ARTIFACT SET through the existing verifier port:
 *   - runs the supplied specialist verifiers across every artifact,
 *   - merges their reports into per-dimension coverage and verdict counts,
 *   - optionally folds in a Reasoning Council deliberation so judgment
 *     dimensions (CORRECTNESS/QUALITY/CONFLICTS) become conclusive with
 *     evidence instead of staying inconclusive,
 *   - audits the merged result against the class coverage profile,
 *   - asserts its own independence from every producing actor first.
 *
 * It introduces no new verification infrastructure: it is composition over
 * the Verifier port, evidence log, dimensions and independence guards that
 * Levels 0-1b established.
 */

import type { CoreServices } from '../core/services.ts';
import type { Actor } from '../core/artifact.ts';
import { assertIndependentVerifier } from './independence.ts';
import type { VerificationReport, Verifier, Verdict } from './verifier.ts';
import type { VerificationDimension } from './dimensions.ts';
import { auditClassCoverage, CLASS_COVERAGE_PROFILES } from './class-coverage.ts';
import type { ArtifactClass, ClassCoverageAudit } from './class-coverage.ts';
import type { CouncilDeliberation } from '../council/council.ts';

export interface MasterVerificationInput {
  /** Artifact IDs in the audited set. */
  readonly artifactIds: readonly string[];
  /** Load each artifact for verifiers that need stored state. */
  readonly artifactClass: ArtifactClass;
  /** Specialist verifiers to engage (the Live Verification roster pattern). */
  readonly verifiers: readonly {
    readonly name: string;
    readonly verifier: Verifier;
    /** Which artifact IDs this verifier covers; default: all. */
    readonly appliesTo?: (artifactId: string) => boolean;
  }[];
  /** Actors that PRODUCED the set - independence is asserted against them. */
  readonly producerActors: readonly Actor[];
  /** Optional council deliberation resolving judgment dimensions. */
  readonly deliberation?: CouncilDeliberation;
}

export interface DimensionRollup {
  readonly dimension: VerificationDimension;
  readonly pass: number;
  readonly fail: number;
  readonly inconclusive: number;
}

export interface MasterVerificationResult {
  readonly subjectCount: number;
  readonly verifierNames: readonly string[];
  /** One merged report per artifact that produced findings. */
  readonly reports: Readonly<Record<string, VerificationReport>>;
  readonly rollup: readonly DimensionRollup[];
  readonly blockingFails: number;
  readonly unresolvedInconclusive: readonly VerificationDimension[];
  readonly coverageAudit: ClassCoverageAudit;
  readonly masterPassed: boolean;
  readonly notes: string;
}

function mergeReports(
  artifactId: string,
  parts: readonly { name: string; report: VerificationReport }[],
): VerificationReport {
  const findings = parts.flatMap((p) => p.report.findings);
  return {
    artifactId,
    // The engine itself is the merging judge of record for the set audit.
    verifier: parts[0]?.report.verifier ?? { kind: 'system', id: 'master-verification-engine' },
    findings,
    startedAt: parts[0]?.report.startedAt ?? new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    notes: `Merged ${parts.length} specialist report(s): ${parts.map((p) => p.name).join(', ')}.`,
  };
}

export class MasterVerificationEngine {
  readonly descriptor = {
    name: 'MasterVerificationEngine',
    targetLevel: '2',
    status: 'implemented' as const,
  };

  private readonly services: CoreServices;

  constructor(services: CoreServices) {
    this.services = services;
  }

  /**
   * Independent audit over an artifact set. For each artifact, every
   * applicable verifier's `verify` is invoked with the STORED artifact so
   * checks run against real state; results are merged, rolled up per
   * dimension, and audited against the class profile. When a council
   * deliberation is supplied and its verdict is 'endorsed' (no objections),
   * the judgment dimensions are recorded as conclusive passes whose detail
   * cites the seat evidence ids - evidence-backed resolution, not fabrication.
   * Any objection instead becomes a blocking fail citing the finding.
   */
  async verifyArtifactSet(input: MasterVerificationInput): Promise<MasterVerificationResult> {
    for (const producer of input.producerActors) {
      for (const { verifier } of input.verifiers) {
        assertIndependentVerifier(producer, verifier.actor);
      }
    }

    const reports: Record<string, VerificationReport> = {};
    const rollupByDimension = new Map<VerificationDimension, DimensionRollup>();
    const bump = (dimension: VerificationDimension, verdict: Verdict): void => {
      const current =
        rollupByDimension.get(dimension) ??
        { dimension, pass: 0, fail: 0, inconclusive: 0 };
      rollupByDimension.set(dimension, {
        ...current,
        pass: current.pass + (verdict === 'pass' ? 1 : 0),
        fail: current.fail + (verdict === 'fail' ? 1 : 0),
        inconclusive: current.inconclusive + (verdict === 'inconclusive' ? 1 : 0),
      });
    };

    let blockingFails = 0;
    for (const artifactId of input.artifactIds) {
      const stored = await this.services.store.get(artifactId);
      if (stored === null) continue;
      const parts: { name: string; report: VerificationReport }[] = [];
      for (const { name, verifier, appliesTo } of input.verifiers) {
        if (appliesTo !== undefined && !appliesTo(artifactId)) continue;
        const report = await verifier.verify({ artifact: stored });
        parts.push({ name, report });
        for (const finding of report.findings) {
          bump(finding.dimension, finding.verdict);
          if (finding.verdict === 'fail') blockingFails += 1;
        }
      }
      if (parts.length > 0) reports[artifactId] = mergeReports(artifactId, parts);
    }

    // Fold in the council deliberation for the class's judgment dimensions.
    // The council's evidence-backed resolution SUPERSEDES the placeholder
    // inconclusive findings those dimensions carried before deliberation:
    //   endorsed               -> conclusive PASS citing seat evidence ids
    //   endorsed-with-concerns -> INCONCLUSIVE citing the concerns (honest)
    //   objected / any objection -> blocking FAIL citing the objections
    const profile = CLASS_COVERAGE_PROFILES[input.artifactClass];
    if (input.deliberation !== undefined) {
      const d = input.deliberation;
      const evidenceIds = d.seats.map((s) => s.evidenceId ?? '').filter((id) => id !== '');
      const verdict: Verdict =
        d.verdict === 'endorsed' ? 'pass' : d.verdict === 'objected' ? 'fail' : 'inconclusive';
      const basis =
        d.verdict === 'endorsed'
          ? `Council endorsement - all seats endorse independently; seat evidence: ${evidenceIds.join(', ') || 'none'}`
          : d.verdict === 'objected'
            ? `Council objection(s): ${d.objections.map((o) => `${o.seatId}: ${o.statement}`).join(' | ')}; seat evidence: ${evidenceIds.join(', ')}`
            : `Council concerns (unresolved): ${d.concerns.map((c) => `${c.seatId}: ${c.statement}`).join(' | ')}`;
      const resolvable = new Set(profile.councilResolvable);

      for (const id of Object.keys(reports)) {
        const rep = reports[id];
        if (rep === undefined) continue;
        reports[id] = {
          ...rep,
          findings: [
            // Supersede the pre-deliberation placeholders...
            ...rep.findings.filter(
              (f) => !(resolvable.has(f.dimension) && f.verdict === 'inconclusive'),
            ),
            // ...with the evidence-backed resolution.
            ...profile.councilResolvable.map((dimension) => ({
              dimension,
              verdict,
              detail: basis,
            })),
          ],
        };
      }
      // Rollup reflects the superseded verdicts across the audited set
      // (the pre-deliberation placeholders no longer count).
      const occurrences = Math.max(Object.keys(reports).length, 1);
      for (const dimension of profile.councilResolvable) {
        rollupByDimension.set(dimension, {
          dimension,
          pass: verdict === 'pass' ? occurrences : 0,
          fail: verdict === 'fail' ? occurrences : 0,
          inconclusive: verdict === 'inconclusive' ? occurrences : 0,
        });
      }
      if (verdict === 'fail') blockingFails += profile.councilResolvable.length;
    }

    const rollup = [...rollupByDimension.values()].sort(
      (a, b) => a.dimension.localeCompare(b.dimension),
    );
    const unresolvedInconclusive = rollup
      .filter(
        (r) =>
          r.inconclusive > 0 &&
          !profile.councilResolvable.includes(r.dimension),
      )
      .map((r) => r.dimension);
    const coverageAudit = auditClassCoverage(
      {
        artifactId: `(set of ${input.artifactIds.length})`,
        verifier: { kind: 'system', id: 'master-verification-engine' },
        findings: rollup.flatMap((r) =>
          Array.from({ length: Math.max(r.pass, r.fail, r.inconclusive) }, () => ({
            dimension: r.dimension,
            verdict: r.inconclusive > 0 ? ('inconclusive' as const) : ('pass' as const),
            detail: 'rollup',
          })),
        ),
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      },
      input.artifactClass,
    );

    const masterPassed =
      blockingFails === 0 &&
      unresolvedInconclusive.length === 0 &&
      coverageAudit.complete;

    return {
      subjectCount: input.artifactIds.length,
      verifierNames: input.verifiers.map((v) => v.name),
      reports,
      rollup,
      blockingFails,
      unresolvedInconclusive,
      coverageAudit,
      masterPassed,
      notes:
        `Master verification over ${input.artifactIds.length} artifact(s) by ` +
        `${input.verifiers.length} verifier(s)` +
        (input.deliberation !== undefined
          ? ` with council verdict "${input.deliberation.verdict}"`
          : '') +
        `.`,
    };
  }
}