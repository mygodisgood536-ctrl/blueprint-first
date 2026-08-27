/**
 * Live Verification Engine (Level 2).
 *
 * Level-2 scope: "live" means re-engaging the verification roster against the
 * CURRENT stored state of an artifact set - right now, not against the last
 * recorded judgment - and reporting DRIFT relative to a prior master
 * verification result. (Verification of deployed runtime systems is the
 * Level-4 extension of this same engine; nothing is faked here.)
 *
 * Drift categories per artifact/dimension:
 *   - was pass / now fail        -> REGRESSED
 *   - was inconclusive / now X   -> RESOLVED (progress)
 *   - was pass / now inconclusive-> DEGRADED
 */

import type { CoreServices } from '../core/services.ts';
import { assertIndependentVerifier } from './independence.ts';
import type { VerificationDimension } from './dimensions.ts';
import type { MasterVerificationInput, MasterVerificationResult } from './master-engine.ts';
import { MasterVerificationEngine } from './master-engine.ts';

export interface DriftItem {
  readonly artifactId: string;
  readonly dimension: VerificationDimension;
  readonly was: string;
  readonly now: string;
  readonly kind: 'REGRESSED' | 'RESOLVED' | 'DEGRADED' | 'CHANGED';
  /**
   * Where this drift item came from. Level 4 introduces telemetry-driven
   * drift in addition to the re-verification path. The field is always
   * present (L0-L3 callers will see 'verification' from the worker).
   */
  readonly source: 'verification' | 'telemetry' | 'remediation';
  /** Free-form evidence reference; for telemetry this is the observation id. */
  readonly evidenceRef?: string;
}

export interface LiveVerificationResult {
  readonly reverifiedCount: number;
  readonly masterNow: MasterVerificationResult;
  readonly drift: readonly DriftItem[];
  readonly regressed: number;
  readonly stable: boolean;
  readonly notes: string;
}

function verdictFor(
  result: MasterVerificationResult,
  artifactId: string,
  dimension: VerificationDimension,
): string {
  const findings = result.reports[artifactId]?.findings.filter((f) => f.dimension === dimension) ?? [];
  if (findings.length === 0) return 'absent';
  const fail = findings.some((f) => f.verdict === 'fail');
  const inconclusive = findings.some((f) => f.verdict === 'inconclusive');
  return fail ? 'fail' : inconclusive ? 'inconclusive' : 'pass';
}

export class LiveVerificationEngine {
  readonly descriptor = {
    name: 'LiveVerificationEngine',
    targetLevel: '2',
    status: 'implemented' as const,
  };

  private readonly services: CoreServices;

  constructor(services: CoreServices) {
    this.services = services;
  }

  /**
   * Re-runs the SAME verification input as the prior master run and diffs the
   * per-artifact/per-dimension verdicts. Producers must differ from every
   * engaged verifier, exactly like the master run.
   */
  async reverify(
    input: MasterVerificationInput,
    prior: MasterVerificationResult,
  ): Promise<LiveVerificationResult> {
    for (const producer of input.producerActors) {
      for (const { verifier } of input.verifiers) {
        assertIndependentVerifier(producer, verifier.actor);
      }
    }
    const engine = new MasterVerificationEngine(this.services);
    const masterNow = await engine.verifyArtifactSet(input);

    const drift: DriftItem[] = [];
    let reverifiedCount = 0;
    for (const artifactId of input.artifactIds) {
      if (masterNow.reports[artifactId] === undefined && prior.reports[artifactId] === undefined) {
        continue;
      }
      reverifiedCount += 1;
      const dimensions = new Set<VerificationDimension>([
        ...(prior.reports[artifactId]?.findings.map((f) => f.dimension) ?? []),
        ...(masterNow.reports[artifactId]?.findings.map((f) => f.dimension) ?? []),
      ]);
      for (const dimension of dimensions) {
        const was = verdictFor(prior, artifactId, dimension);
        const now = verdictFor(masterNow, artifactId, dimension);
        if (was === now) continue;
        let kind: DriftItem['kind'] = 'CHANGED';
        if (was === 'pass' && now === 'fail') kind = 'REGRESSED';
        else if (was === 'pass' && now === 'inconclusive') kind = 'DEGRADED';
        else if (was !== 'pass' && now === 'pass') kind = 'RESOLVED';
        drift.push({ artifactId, dimension, was, now, kind, source: 'verification' });
      }
    }

    const regressed = drift.filter((d) => d.kind === 'REGRESSED').length;
    return {
      reverifiedCount,
      masterNow,
      drift,
      regressed,
      stable: regressed === 0,
      notes:
        `Live re-verification of ${reverifiedCount} artifact(s): ${drift.length} drift item(s), ` +
        `${regressed} regression(s).`,
    };
  }
}