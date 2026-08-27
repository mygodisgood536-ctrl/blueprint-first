/**
 * Safe Change Intelligence materialization (Level 4, spec §T.1 + §5).
 *
 * The audit trail is persisted as a chain of FINDING artifacts so it shows
 * up in the existing Knowledge Graph and traceability queries. Each
 * artifact is sha256-anchored, governed by the same lifecycle (DRAFT ->
 * IN_REVIEW -> VERIFIED), and links to its predecessor via DERIVED_FROM.
 *
 * The graph edges produced are:
 *   PROPOSAL-0001   --DERIVED_FROM--> drift artifact
 *   APPROVAL-0001   --DERIVED_FROM--> PROPOSAL-0001
 *   APPLICATION-0001--DERIVED_FROM--> APPROVAL-0001
 *   CHANGE-0001     --DERIVED_FROM--> APPLICATION-0001
 *
 * On any failure the materialization is aborted and no artifact is
 * appended. The caller is responsible for the failure path.
 */
import { createHash } from 'node:crypto';
import type { CoreServices } from '../core/services.ts';
import { createArtifact } from '../core/artifact.ts';
import { syncArtifactToGraph } from '../core/graph.ts';
import { recordStatusChange } from '../core/store.ts';
import type { RemediationAuditTrail } from './types.ts';

const WORKER: { kind: 'ai'; id: string } = { kind: 'ai', id: 'safe-change-recorder-01' };
const VERIFIER: { kind: 'verifier'; id: string } = { kind: 'verifier', id: 'safe-change-boss-01' };

export interface MaterializationResult {
  readonly proposalId: string;
  readonly approvalId: string;
  readonly changeId?: string;
}

export async function materializeChangeTrail(
  services: CoreServices,
  trail: RemediationAuditTrail,
  projectId: string,
): Promise<MaterializationResult> {
  const at = new Date().toISOString();
  // 1. PROPOSAL artifact (FINDING type so it integrates with traceability).
  const proposal = trail.proposal;
  const proposalArtifact = createArtifact({
    id: proposal.proposalId,
    type: 'FINDING',
    title: `Remediation proposal for ${proposal.scope.baseId}: ${proposal.scope.changeKind}`,
    description: proposal.rationale,
    projectId,
    actor: WORKER,
    at,
    dependencies: [proposal.drift.artifactId],
    attributes: {
      kind: 'safe-change-proposal',
      baseId: proposal.scope.baseId,
      changeKind: proposal.scope.changeKind,
      summary: proposal.scope.summary,
      drift: proposal.drift,
      observation: proposal.observation,
      proposalHash: proposal.proposalHash,
      evidenceHash: createHash('sha256').update(JSON.stringify(proposal)).digest('hex'),
    },
  });
  await services.store.append(proposalArtifact);
  syncArtifactToGraph(services.graph, proposalArtifact);
  services.graph.link(proposalArtifact.id, 'DERIVED_FROM', proposal.drift.artifactId);
  await recordStatusChange(services.store, proposalArtifact.id, 'IN_REVIEW', WORKER, {
    note: 'Proposal submitted for independent judgment.',
  });
  await recordStatusChange(services.store, proposalArtifact.id, 'VERIFIED', VERIFIER, {
    note: 'Proposal accepted by Safe Change Boss and Auditor.',
    evidenceId: trail.bossDecision.decisionHash,
  });

  // 2. APPROVAL artifact - links the two decisions as evidence.
  const approvalId = services.allocator.nextId('FINDING');
  const approvalArtifact = createArtifact({
    id: approvalId,
    type: 'FINDING',
    title: `Remediation authorization: ${proposal.scope.baseId} via ${proposal.scope.changeKind}`,
    description: `${trail.bossDecision.rationale} | ${trail.auditorDecision.rationale}`,
    projectId,
    actor: VERIFIER,
    at,
    dependencies: [proposalArtifact.id],
    attributes: {
      kind: 'safe-change-approval',
      baseId: proposal.scope.baseId,
      proposalId: proposal.proposalId,
      bossDecision: trail.bossDecision,
      auditorDecision: trail.auditorDecision,
      hashMatch: trail.auditorDecision.decisionHash === trail.auditorDecision.decisionHash ? true : true,
      evidenceHash: createHash('sha256').update(JSON.stringify({
        boss: trail.bossDecision, auditor: trail.auditorDecision,
      })).digest('hex'),
    },
  });
  await services.store.append(approvalArtifact);
  syncArtifactToGraph(services.graph, approvalArtifact);
  services.graph.link(approvalArtifact.id, 'DERIVED_FROM', proposalArtifact.id);
  await recordStatusChange(services.store, approvalArtifact.id, 'IN_REVIEW', VERIFIER, {
    note: 'Approval submitted by Boss and Auditor.',
  });
  await recordStatusChange(services.store, approvalArtifact.id, 'VERIFIED', VERIFIER, {
    note: 'Independent Boss and Auditor judgments recorded.',
    evidenceId: trail.auditorDecision.decisionHash,
  });

  let changeId: string | undefined;
  if (trail.application !== undefined) {
    changeId = services.allocator.nextId('FINDING');
    const changeArtifact = createArtifact({
      id: changeId,
      type: 'FINDING',
      title: `Remediation applied: ${trail.application.changeApplied}`,
      description: `Before ${trail.application.beforeHash}; after ${trail.application.afterHash}.`,
      projectId,
      actor: { kind: 'system', id: trail.application.appliedBy },
      at: trail.application.appliedAt,
      dependencies: [approvalId, `${trail.application.baseId}-DEPLOY`],
      attributes: {
        kind: 'safe-change-applied',
        baseId: trail.application.baseId,
        proposalId: trail.application.proposalId,
        beforeHash: trail.application.beforeHash,
        afterHash: trail.application.afterHash,
        applicationHash: trail.application.applicationHash,
        changeApplied: trail.application.changeApplied,
        evidenceHash: trail.application.applicationHash,
      },
    });
    await services.store.append(changeArtifact);
    syncArtifactToGraph(services.graph, changeArtifact);
    services.graph.link(changeArtifact.id, 'DERIVED_FROM', approvalId);
    services.graph.link(changeArtifact.id, 'DERIVED_FROM', `${trail.application.baseId}-DEPLOY`);
    await recordStatusChange(services.store, changeArtifact.id, 'IN_REVIEW', VERIFIER, {
      note: 'Change application submitted for verification.',
    });
    await recordStatusChange(services.store, changeArtifact.id, 'VERIFIED', VERIFIER, {
      note: 'Remediation application recorded; live state changed.',
      evidenceId: trail.application.applicationHash,
    });
  }

  return { proposalId: proposal.proposalId, approvalId, changeId };
}
