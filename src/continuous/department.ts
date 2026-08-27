/**
 * Continuous Engineering Department (spec §5) - the fourth and final
 * department in the pipeline, running against the DEPLOYED-VERIFIED scope
 * after Stage 4's Operations Department has certified production.
 *
 * Flow:
 *   1. Continuous Worker Corps re-runs the master verification against the
 *      live store, producing a report split into driftFindings and stableUnits.
 *   2. Continuous Engineering Boss independently reconstructs the expected
 *      live-stable state from certified baselines and diffs against the
 *      worker's report. Any divergence rejects the entire run.
 *   3. Continuous Engineering Auditor re-executes the worker's observation on
 *      a deterministic sample and checks for exact reproducibility.
 *   4. If both Boss and Auditor accept, materialize -OPS per-artifact records
 *      and a COMPONENT-level PERM manifest. Advance DoC to CERTIFIED COMPLETE.
 *   5. If either rejects, materialize drift findings and halt. The Safe Change
 *      Intelligence path (future) will consume these drift items.
 *
 * The department returns a decision object that callers can inspect to see
 * what happened without parsing artifact attributes.
 */
import type { CoreServices } from '../core/services.ts';
import { runContinuousWorker, type ContinuousObservation, type ContinuousWorkerReport } from './worker.ts';
import { runContinuousBoss, type ContinuousBossDecision } from './boss.ts';
import { runContinuousAuditor, type ContinuousAuditorDecision } from './auditor.ts';
import { materializeContinuousRun, type ContinuousMaterializationResult } from './materialize.ts';

export interface ContinuousDepartmentResult {
  readonly projectId: string;
  readonly workerReport: ContinuousWorkerReport;
  readonly bossDecision: ContinuousBossDecision;
  readonly auditorDecision: ContinuousAuditorDecision;
  readonly materialization: ContinuousMaterializationResult | null;
  readonly finalVerdict: 'CERTIFIED_COMPLETE' | 'DRIFT_DETECTED' | 'REJECTED_BY_BOSS' | 'REJECTED_BY_AUDITOR';
  readonly rationale: string;
}

export async function runContinuousEngineeringDepartment(
  services: CoreServices,
  projectId: string,
  options: { sampleSize?: number; defects?: { simulateRegressed?: readonly string[]; simulateDegraded?: readonly string[] } } = {},
): Promise<ContinuousDepartmentResult> {
  // 1. Worker Corps
  const workerReport = await runContinuousWorker(services, projectId, options.defects ?? {});

  // 2. Boss - independent reconstruction
  const bossDecision = await runContinuousBoss(services, projectId, workerReport, { sampleSize: options.sampleSize });

  // 3. Auditor - independent re-execution
  const auditorDecision = await runContinuousAuditor(services, projectId, workerReport.observations, options.sampleSize ?? Math.max(1, Math.ceil(workerReport.observations.length / 2)));

  // 4. Outcome
  let finalVerdict: ContinuousDepartmentResult['finalVerdict'] = 'CERTIFIED_COMPLETE';
  let rationale = '';
  let materialization: ContinuousMaterializationResult | null = null;

  if (bossDecision.verdict === 'rejected') {
    finalVerdict = 'REJECTED_BY_BOSS';
    rationale = `Boss rejected: ${bossDecision.rationale}`;
  } else if (auditorDecision.verdict === 'rejected') {
    finalVerdict = 'REJECTED_BY_AUDITOR';
    rationale = `Auditor rejected: ${auditorDecision.rationale}`;
  } else if (workerReport.regressedCount > 0 || workerReport.degradedCount > 0) {
    finalVerdict = 'DRIFT_DETECTED';
    rationale = `Drift detected by worker (regressed: ${workerReport.regressedCount}, degraded: ${workerReport.degradedCount}) - Safe Change path required.`;
  } else {
    // Materialize and advance DoC
    const meta = {
      projectId,
      observedAt: workerReport.observedAt,
      bossRationale: bossDecision.rationale,
      auditorRationale: auditorDecision.rationale,
      stableCount: workerReport.stableCount,
      regressedCount: workerReport.regressedCount,
      degradedCount: workerReport.degradedCount,
      resolvedCount: workerReport.resolvedCount,
      reportHash: workerReport.reportHash,
    };
    materialization = await materializeContinuousRun(services, workerReport.observations, meta);
    rationale = `Certified Complete — ${workerReport.stableCount} artifact(s) confirmed stable by Boss and Auditor. Living Blueprint manifest: ${materialization.manifestId}`;
  }

  return {
    projectId,
    workerReport,
    bossDecision,
    auditorDecision,
    materialization,
    finalVerdict,
    rationale,
  };
}