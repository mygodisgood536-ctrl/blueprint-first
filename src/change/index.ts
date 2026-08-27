/** Public exports for the Safe Change Intelligence Department (Level 4). */
export {
  runChangeAnalyst,
  type AnalystProposalInput,
  type AnalystProposalResult,
} from './analyst.ts';
export {
  runSafeChangeBoss,
  SAFE_CHANGE_BOSS_ACTOR,
} from './boss.ts';
export {
  runSafeChangeAuditor,
  SAFE_CHANGE_AUDITOR_ACTOR,
  type AuditorResult,
} from './auditor.ts';
export {
  applyAuthorizedRemediation,
  SAFE_CHANGE_APPLIER_ACTOR,
  type ApplierInput,
  type ApplierResult,
} from './applier.ts';
export {
  runSafeChangeDepartment,
  type ChangeDepartmentResult,
  type ChangeDepartmentInput,
} from './department.ts';
export {
  materializeChangeTrail,
  type MaterializationResult,
} from './materialize.ts';
export type {
  RemediationStatus,
  RemediationScope,
  RemediationProposal,
  RemediationDecision,
  AppliedRemediation,
  RemediationAuditTrail,
} from './types.ts';
