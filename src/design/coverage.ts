/**
 * Design-coverage assessment and governance gate (expansion §10).
 *
 * Assesses, per project, which of the structured DESIGN_COVERAGE_DIMENSIONS
 * are evidenced by the produced page design documents. This is separate from -
 * and additive to - the guarded 11 verification dimensions: it does not widen
 * verifier.dimensions. Instead it feeds design COMPLETENESS evidence into the
 * existing COVERAGE finding path and provides an explicit governance gate that
 * the certification flow can honor without altering the certification
 * authority itself.
 *
 * The assessment is honest: a dimension is "covered" only when a concrete,
 * machine-evaluable field exists on the design docs. Dimensions the design
 * derivation does not yet produce are reported as missing rather than
 * fabricated.
 */

import { createHash } from 'node:crypto';
import type { PageDesignDoc } from './types.ts';
import type { DesignCoverageDimension, DesignCoverageAssessment } from '../project/types.ts';
import {
  DESIGN_COVERAGE_DIMENSIONS,
  requiredDesignDimensionsFor,
} from '../project/types.ts';
import type { ProjectMode } from '../project/types.ts';
import type { EvidenceLog } from '../verification/evidence.ts';

/**
 * Which design-coverage dimensions a single page design doc evidences.
 * A dimension is covered when the doc carries a concrete structured field (or
 * derived content) that meaningfully addresses it.
 */
export function pageDesignEvidences(doc: PageDesignDoc): Set<DesignCoverageDimension> {
  const covered = new Set<DesignCoverageDimension>();
  const layoutTypes: string[] = doc.layout.map((l) => l.contentType);
  const hasForm = layoutTypes.includes('form');
  const stateNames = doc.stateHandling.map((s) => s.name.toLowerCase());
  const runtimeNames = (doc.runtimeStates ?? []).map((s) => s.name.toLowerCase());
  const securityRoles = doc.securityNotes.flatMap((n) => n.roles);
  const responsive = doc.responsive ?? [];
  const constraints = `${doc.constraints ?? ''} ${doc.apiNotes ?? ''} ${doc.dataNotes ?? ''}`.toLowerCase();

  if (doc.title.trim().length > 0) covered.add('product-vision');
  if (doc.purpose.trim().length > 0) covered.add('user-journeys');
  if (doc.interactions.length > 0) covered.add('features');
  if (doc.layout.length > 0) covered.add('pages-screens');
  if (doc.stateHandling.length > 0) covered.add('workflows');

  if (doc.layout.length > 0) covered.add('components');
  if (doc.stateHandling.length > 0) covered.add('states');
  if (doc.interactions.length > 0) covered.add('interactions');
  if (doc.navigation.route.trim().length > 0) covered.add('navigation');
  if (hasForm) covered.add('forms');
  if (doc.layout.length > 0) covered.add('layout-structure');

  const tokens = doc.designTokens;
  const typo = tokens?.typography;
  if (typo && (typo.display?.size || typo.heading?.size || typo.body?.size)) covered.add('visual-hierarchy');
  if (tokens?.color?.primary) covered.add('color');
  if (tokens?.typography?.baseFontSize) covered.add('typography');
  if (tokens?.spacing?.unit) covered.add('spacing');
  if (tokens?.color) covered.add('visual-identity');

  if (responsive.length > 0) covered.add('responsive-behavior');
  if (responsive.some((r) => /360|640/.test(`${r.behavior ?? ''} ${r.breakpointMin ?? ''}`))) covered.add('mobile-design');
  if (responsive.some((r) => /768/.test(`${r.behavior ?? ''} ${r.breakpointMin ?? ''}`)) || /tablet/.test(constraints)) covered.add('tablet-design');
  if (doc.layout.length > 0) covered.add('desktop-design');

  if (stateNames.some((n) => n.includes('loading')) || runtimeNames.some((n) => n.includes('loading'))) covered.add('loading-states');
  if (stateNames.some((n) => n.includes('empty')) || runtimeNames.some((n) => n.includes('empty'))) covered.add('empty-states');
  if (doc.interactions.some((i) => i.validationMessages.length > 0)) covered.add('error-states');
  if (doc.interactions.some((i) => /success|confirm|saved/.test(i.outcome))) covered.add('success-states');
  if ((doc.variants ?? []).some((v) => /disabled|inactive/.test(v.key))) covered.add('disabled-states');
  if (doc.interactions.some((i) => i.validationMessages.length > 0)) covered.add('validation-states');
  if (securityRoles.length > 0) covered.add('permission-states');
  if (doc.securityNotes.length > 0 || securityRoles.includes('admin')) covered.add('authentication-states');

  if ((doc.accessibility ?? []).length > 0) covered.add('accessibility');
  if ((doc.variants ?? []).length > 0) covered.add('transitions');
  if ((doc.variants ?? []).some((v) => /animat|motion/.test(v.key))) covered.add('animation');
  if ((doc.variants ?? []).some((v) => /disabled|inactive/.test(v.key))) covered.add('disabled-states');
  if ((doc.iconography ?? []).length > 0) covered.add('icons');
  if ((doc.imagery ?? []).length > 0) covered.add('imagery');
  if ((doc.notificationStates ?? []).length > 0) covered.add('notifications');
  if (doc.interactions.some((i) => i.validationMessages.length > 0)) covered.add('feedback');
  if ((doc.notificationStates ?? []).length > 0) covered.add('feedback');
  if (doc.securityNotes.length > 0) covered.add('security-considerations');
  if (securityRoles.includes('admin')) covered.add('business-admin-requirements');
  if (doc.stateHandling.length > 0 || doc.constraints.trim().length > 0) covered.add('edge-cases');

  return covered;
}

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export interface ProjectDesignCoverageInput {
  readonly pageDesigns: readonly PageDesignDoc[];
  readonly mode: ProjectMode;
}

/**
 * Assesses design-coverage across all page design documents of a project.
 * A required dimension is "covered" when ANY page doc evidences it.
 */
export function assessDesignCoverage(input: ProjectDesignCoverageInput): DesignCoverageAssessment {
  const covered = new Set<DesignCoverageDimension>();
  for (const doc of input.pageDesigns) {
    for (const dim of pageDesignEvidences(doc)) covered.add(dim);
  }
  const allDimensions: readonly DesignCoverageDimension[] = [...DESIGN_COVERAGE_DIMENSIONS];
  const required = requiredDesignDimensionsFor(input.mode);
  const coveredList: DesignCoverageDimension[] = allDimensions.filter((d) => covered.has(d));
  const missing: DesignCoverageDimension[] = required.filter((d) => !covered.has(d));
  // The assessment hash covers the ACTUAL facts of the assessment (which
  // dimensions are covered vs missing), not the static dimension list, so a
  // change in coverage always changes the hash.
  const facts = allDimensions
    .map((d) => `${d}:${covered.has(d) ? 'covered' : 'missing'}`)
    .join('|');
  return {
    allDimensions,
    covered: coveredList,
    missing,
    assessmentHash: `sha256:${sha256Hex(facts)}`,
  };
}

/** Governance gate: satisfied only when no required dimension is missing. */
export function designCoverageGate(
  assessment: DesignCoverageAssessment,
): { satisfied: boolean; missing: readonly DesignCoverageDimension[] } {
  return {
    satisfied: assessment.missing.length === 0,
    missing: assessment.missing,
  };
}

export interface DesignCoverageEvidenceOptions {
  readonly producerId: string;
  readonly projectId: string;
  readonly pageDesignIds: readonly string[];
}

/**
 * Records design-coverage assessment as evidence on the existing EvidenceLog,
 * returning the assessment. This feeds the verification/COVERAGE path with real
 * completeness evidence without touching the guarded dimension array.
 */
export async function recordDesignCoverageEvidence(
  evidence: EvidenceLog,
  assessment: DesignCoverageAssessment,
  options: DesignCoverageEvidenceOptions,
): Promise<DesignCoverageAssessment> {
  const gate = designCoverageGate(assessment);
  await evidence.append({
    kind: 'inspection',
    summary:
      `Design coverage assessed: ${assessment.covered.length}/${assessment.allDimensions.length} covered; ` +
      `${assessment.missing.length} missing${gate.satisfied ? ' (gate satisfied)' : ` (missing: ${gate.missing.join(', ')})`}.`,
    artifactIds: [options.projectId, ...options.pageDesignIds],
    payloadRef: assessment.assessmentHash,
    producer: { kind: 'system', id: options.producerId },
  });
  return assessment;
}
