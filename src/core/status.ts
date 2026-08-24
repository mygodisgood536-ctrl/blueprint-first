/**
 * Artifact lifecycle state machine.
 *
 * Status transitions are explicit and enforced everywhere artifacts change
 * state. Terminal statuses accept no further transitions. This module contains
 * no I/O and no references to other subsystems.
 */

import { InvalidTransitionError } from './errors.ts';

export const ARTIFACT_STATUSES = [
  'DRAFT',
  'IN_REVIEW',
  'CHANGES_REQUESTED',
  'VERIFIED',
  'APPROVED',
  'REJECTED',
  'BLOCKED',
  'SUPERSEDED',
  'DEPRECATED',
  'ARCHIVED',
] as const;

export type ArtifactStatus = (typeof ARTIFACT_STATUSES)[number];

/**
 * Allowed transitions. Key = current status, value = legal next statuses.
 *
 * Lifecycle intent (Level 1a):
 *  DRAFT -> IN_REVIEW -> VERIFIED -> APPROVED is the happy path.
 *  REJECTED work returns to DRAFT for rework. CHANGES_REQUESTED forces a
 *  review cycle before verification can be attempted again. VERIFIED work may
 *  be sent back to IN_REVIEW by a reviewer. ARCHIVED is terminal.
 */
export const STATUS_TRANSITIONS: Readonly<
  Record<ArtifactStatus, readonly ArtifactStatus[]>
> = {
  DRAFT: ['IN_REVIEW', 'BLOCKED', 'DEPRECATED'],
  IN_REVIEW: ['CHANGES_REQUESTED', 'VERIFIED', 'REJECTED', 'BLOCKED'],
  CHANGES_REQUESTED: ['IN_REVIEW', 'DRAFT', 'DEPRECATED'],
  VERIFIED: ['APPROVED', 'IN_REVIEW', 'BLOCKED'],
  APPROVED: ['SUPERSEDED', 'DEPRECATED', 'ARCHIVED'],
  REJECTED: ['DRAFT', 'DEPRECATED'],
  BLOCKED: ['DRAFT', 'IN_REVIEW'],
  SUPERSEDED: ['ARCHIVED'],
  DEPRECATED: ['ARCHIVED'],
  ARCHIVED: [],
};

export function canTransition(from: ArtifactStatus, to: ArtifactStatus): boolean {
  return STATUS_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: ArtifactStatus, to: ArtifactStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(from, to, STATUS_TRANSITIONS[from]);
  }
}

export function isTerminalStatus(status: ArtifactStatus): boolean {
  return STATUS_TRANSITIONS[status].length === 0;
}
