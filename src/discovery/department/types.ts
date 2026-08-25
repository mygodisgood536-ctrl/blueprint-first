/**
 * Discovery Department domain types - Level 1b (Minimum Viable Discovery
 * Department, spec roadmap: Worker Corps Clusters A+B only, self-verification,
 * one Specialist Verifier per cluster, lightweight Discovery Boss performing
 * independent reconstruction on core artifact types - pages, features,
 * workflows - only).
 *
 * The department keeps the Level-1a output contract (a verified, normalized
 * DiscoveryBaseline materialized into store + graph) while replacing the
 * single reasoning path with the spec's two-cluster organization plus an
 * independent boss gate.
 */

import type { NormalizedInventory } from '../normalize.ts';
import type { VerificationReport } from '../../verification/verifier.ts';
import type { BossDecision } from '../../orchestration/worker-boss.ts';

/** Cluster A (Understanding Workers) raw response schema. */
export interface RawUnderstandingResult {
  product: { name: string; summary: string };
  /** Short domain characterization produced from the brief alone. */
  domainProfile?: string;
  /** §0.14 self-verification: surfaced uncertainties, never silently dropped. */
  selfCheck?: { uncertainties?: readonly string[] };
}

/** Cluster B (Structural Workers) raw response schema - everything but product. */
export interface RawStructuralResult {
  modules?: unknown;
  features?: unknown;
  workflows?: unknown;
  pages?: unknown;
  rules?: unknown;
  permissions?: unknown;
  entities?: unknown;
  apis?: unknown;
  integrations?: unknown;
  selfCheck?: { uncertainties?: readonly string[] };
}

/** Core artifact types the Level-1b boss reconstructs (spec roadmap: exactly these three). */
export const CORE_RECONSTRUCTION_TYPES = ['FEATURE', 'WORKFLOW', 'PAGE'] as const;
export type CoreReconstructionType = (typeof CORE_RECONSTRUCTION_TYPES)[number];

/** One independently reconstructed core artifact expectation. */
export interface BossExpectationItem {
  readonly key: string;
  readonly title: string;
}

/** The boss's expectation, built ONLY from the brief + platform knowledge. */
export interface ReconstructionExpectation {
  readonly productName: string;
  readonly features: readonly BossExpectationItem[];
  readonly workflows: readonly BossExpectationItem[];
  readonly pages: readonly BossExpectationItem[];
}

export interface ReconstructionDelta {
  readonly kind: 'missing' | 'extra';
  readonly coreType: CoreReconstructionType;
  /** Present on 'missing': the boss-expected identity with no worker counterpart. */
  readonly bossKey?: string;
  readonly bossTitle?: string;
  /** Present on 'extra': the worker-produced identity with no boss expectation. */
  readonly workerKey?: string;
  readonly workerTitle?: string;
  /** How a matched pair was correlated (never present on a delta). */
}

export interface ReconstructionDiffRecord {
  readonly expectation: ReconstructionExpectation;
  readonly deltas: readonly ReconstructionDelta[];
  /** Matched pairs kept for the record: worker key -> correlation basis. */
  readonly matches: Readonly<Record<string, 'key' | 'title' | 'tokens'>>;
}

export interface DepartmentRunResult {
  readonly status: 'accepted' | 'rejected' | 'failed';
  readonly baseline?: import('../materialize.ts').DiscoveryBaseline;
  readonly inventory?: NormalizedInventory;
  readonly understandingReport?: VerificationReport;
  readonly structuralReport?: VerificationReport;
  readonly bossDecision?: BossDecision;
  readonly diff?: ReconstructionDiffRecord;
  readonly findingIds?: readonly string[];
  readonly uncertainties?: Readonly<{
    understanding: readonly string[];
    structural: readonly string[];
  }>;
  readonly error?: { code: string; message: string };
  readonly artifactIds: readonly string[];
}