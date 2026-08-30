/**
 * Project identity, mode, and design-coverage requirements (expansion §6, §10-12).
 *
 * These are structured, machine-readable project facts — not UI labels or chat
 * text. The selected ProjectMode governs which lifecycle stages are in scope
 * and which design-coverage dimensions are required before the certification
 * authority will certify design completion.
 */

/**
 * The three creation modes from the expansion specification.
 *
 * - DESIGN_ONLY:      Discovery -> Design -> Design Verification
 *                      (stops before production implementation)
 * - DESIGN_PLUS_CODE: Discovery -> Design -> Approval -> Blueprint ->
 *                      Architecture -> Implementation -> Testing -> Verification
 * - FULL_PRODUCT:     Discovery -> Design -> Blueprint -> Build -> Test ->
 *                      Verify -> Deploy -> Operate -> Maintain -> Continuously Improve
 *
 * The mode is established at project creation and becomes part of the project's
 * structured configuration/state. Changing the mode requires explicit action.
 */
export type ProjectMode = 'design-only' | 'design-plus-code' | 'full-product';

export const PROJECT_MODES: readonly ProjectMode[] = [
  'design-only',
  'design-plus-code',
  'full-product',
] as const;

export const PROJECT_MODE_LABELS: Readonly<Record<ProjectMode, string>> = {
  'design-only': 'Design Only',
  'design-plus-code': 'Design + Code',
  'full-product': 'Full Product',
};

export const PROJECT_MODE_DESCRIPTIONS: Readonly<Record<ProjectMode, string>> = {
  'design-only':
    'Discovery, design, and design verification — no production implementation unless the mode is changed.',
  'design-plus-code':
    'Discovery, design, approval, blueprint, architecture, implementation, testing, and verification.',
  'full-product':
    'Full lifecycle: discovery, design, blueprint, build, test, verify, deploy, operate, maintain, continuously improve.',
};

/**
 * The lifecycle stage at which each mode stops. Stages beyond this are
 * OUT OF SCOPE for the project. The system reports them honestly as "not in scope"
 * rather than falsely representing them as completed.
 */
export const PROJECT_MODE_LIFECYCLE_COMPLETE: Readonly<
  Record<ProjectMode, string>
> = {
  'design-only': 'design-verification',
  'design-plus-code': 'verification',
  'full-product': 'continuous-improvement',
};

/**
 * Every design-coverage dimension that Blueprint-First can assess.
 *
 * This taxonomy is organized by category so that:
 *   - the existing verification dimensions (COUNT, COVERAGE, etc.) remain
 *     untouched (the 11-dimension guard is preserved);
 *   - design *completeness* is assessed against these finer-grained
 *     design-coverage dimensions, producing evidence that feeds the existing
 *     COVERAGE verification finding;
 *   - the certification authority consumes the resulting evidence.
 *
 * "Visual design" here means structured, machine-evaluable fields on the design
 * artifacts — not a separate design system. The existing Design Studio derives
 * structural design; these dimensions represent the *completeness* of that
 * derivation across the product vision's requirements.
 */
export const DESIGN_COVERAGE_DIMENSIONS = [
  // ── Product / requirement coverage ──
  'product-vision',
  'user-journeys',
  'features',
  'pages-screens',
  'workflows',

  // ── UI structure ──
  'components',
  'states',
  'interactions',
  'navigation',
  'forms',
  'layout-structure',

  // ── Visual design ──
  'visual-hierarchy',
  'color',
  'typography',
  'spacing',
  'visual-identity',

  // ── Responsive design ──
  'responsive-behavior',
  'mobile-design',
  'tablet-design',
  'desktop-design',

  // ── States & feedback ──
  'loading-states',
  'empty-states',
  'error-states',
  'success-states',
  'disabled-states',
  'validation-states',
  'authentication-states',
  'permission-states',

  // ── Quality attributes ──
  'accessibility',
  'transitions',
  'animation',
  'icons',
  'imagery',
  'notifications',
  'feedback',

  // ── Security & business ──
  'security-considerations',
  'business-admin-requirements',

  // ── Edge cases ──
  'edge-cases',
] as const;

export type DesignCoverageDimension = (typeof DESIGN_COVERAGE_DIMENSIONS)[number];

/**
 * Which design-coverage dimensions are required for each project mode.
 *
 * All modes require the full explicit design-coverage taxonomy. The difference
 * between modes is *which later stages* are in scope, not which
 * design-coverage dimensions are required — design completeness is always
 * required before implementation or certification proceeds.
 *
 * The certification authority (certification.ts) refuses to certify design
 * completion when any required dimension is missing from the assessed evidence.
 */
export function requiredDesignDimensionsFor(
  mode: ProjectMode,
): readonly DesignCoverageDimension[] {
  void mode; // all modes currently require the full taxonomy
  return DESIGN_COVERAGE_DIMENSIONS;
}

/**
 * The result of assessing design coverage against required dimensions.
 */
export interface DesignCoverageAssessment {
  /** All dimensions that were checked. */
  readonly allDimensions: readonly DesignCoverageDimension[];
  /** Dimensions confirmed present/evidenced on the design artifacts. */
  readonly covered: readonly DesignCoverageDimension[];
  /** Dimensions missing — design certification is blocked if non-empty. */
  readonly missing: readonly DesignCoverageDimension[];
  /** Deterministic sha256 of the assessment inputs (for evidence anchoring). */
  readonly assessmentHash: string;
}

/**
 * Which stages are in-scope for each project mode.
 * Stages not listed are OUT OF SCOPE — reported honestly, never falsely completed.
 */
export const PROJECT_MODE_STAGES: Readonly<
  Record<
    ProjectMode,
    {
      readonly stageId: string;
      readonly label: string;
      readonly inScope: boolean;
    }[]
  >
> = {
  'design-only': [
    { stageId: 'discovery', label: 'Discovery', inScope: true },
    { stageId: 'design', label: 'Design', inScope: true },
    { stageId: 'design-verification', label: 'Design Verification', inScope: true },
    { stageId: 'blueprint', label: 'Blueprint', inScope: false },
    { stageId: 'architecture', label: 'Architecture', inScope: false },
    { stageId: 'implementation', label: 'Implementation', inScope: false },
    { stageId: 'testing', label: 'Testing', inScope: false },
    { stageId: 'verification', label: 'Verification', inScope: false },
    { stageId: 'deployment', label: 'Deployment', inScope: false },
    { stageId: 'operations', label: 'Operations', inScope: false },
    { stageId: 'maintenance', label: 'Maintenance', inScope: false },
    { stageId: 'continuous-improvement', label: 'Continuous Improvement', inScope: false },
  ],
  'design-plus-code': [
    { stageId: 'discovery', label: 'Discovery', inScope: true },
    { stageId: 'design', label: 'Design', inScope: true },
    { stageId: 'design-verification', label: 'Design Verification', inScope: true },
    { stageId: 'blueprint', label: 'Blueprint', inScope: true },
    { stageId: 'architecture', label: 'Architecture', inScope: true },
    { stageId: 'implementation', label: 'Implementation', inScope: true },
    { stageId: 'testing', label: 'Testing', inScope: true },
    { stageId: 'verification', label: 'Verification', inScope: true },
    { stageId: 'deployment', label: 'Deployment', inScope: false },
    { stageId: 'operations', label: 'Operations', inScope: false },
    { stageId: 'maintenance', label: 'Maintenance', inScope: false },
    { stageId: 'continuous-improvement', label: 'Continuous Improvement', inScope: false },
  ],
  'full-product': [
    { stageId: 'discovery', label: 'Discovery', inScope: true },
    { stageId: 'design', label: 'Design', inScope: true },
    { stageId: 'design-verification', label: 'Design Verification', inScope: true },
    { stageId: 'blueprint', label: 'Blueprint', inScope: true },
    { stageId: 'architecture', label: 'Architecture', inScope: true },
    { stageId: 'implementation', label: 'Implementation', inScope: true },
    { stageId: 'testing', label: 'Testing', inScope: true },
    { stageId: 'verification', label: 'Verification', inScope: true },
    { stageId: 'deployment', label: 'Deployment', inScope: true },
    { stageId: 'operations', label: 'Operations', inScope: true },
    { stageId: 'maintenance', label: 'Maintenance', inScope: true },
    { stageId: 'continuous-improvement', label: 'Continuous Improvement', inScope: true },
  ],
};
