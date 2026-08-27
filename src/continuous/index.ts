/** Public exports for the Continuous Engineering Department (Stage 5). */
export {
  runContinuousWorker,
  type ContinuousObservation,
  type ContinuousWorkerReport,
  type ContinuousWorkerDefects,
  type DriftKind,
} from './worker.ts';

export {
  runContinuousBoss,
  type ContinuousBossDecision,
  sampleArtifacts,
} from './boss.ts';

export {
  runContinuousAuditor,
  type ContinuousAuditorDecision,
} from './auditor.ts';

export {
  materializeContinuousRun,
  type ContinuousRunMeta,
  type ContinuousMaterializationResult,
} from './materialize.ts';

export {
  runContinuousEngineeringDepartment,
  type ContinuousDepartmentResult,
} from './department.ts';