/**
 * Visual/UX verification against implementation (Increment 6).
 *
 * Verifies that design tokens, accessibility rules, responsive rules,
 * and interaction/motion specs from page designs are reflected in
 * implementation artifacts. Now reads the REAL design token structure
 * (nested color/typography/spacing/radius/elevation/layout/motion)
 * and compares against the realized design surface written by the build layer.
 */

import type { CoreServices } from '../core/services.ts';
import type { Actor } from '../core/artifact.ts';
import { createArtifact } from '../core/artifact.ts';
import { syncArtifactToGraph } from '../core/graph.ts';
import type { DesignCoverageAssessment } from '../project/types.ts';
import type { DesignRunResult } from '../design/studio.ts';
import type { BuildRunResult } from '../build/types.ts';
import type { DesignTokenSet } from '../design/types.ts';

export interface UXVerificationResult {
  readonly projectId: string;
  readonly tokenCoverage: TokenCoverageReport;
  readonly accessibilityCoverage: AccessibilityCoverageReport;
  readonly responsiveCoverage: ResponsiveCoverageReport;
  readonly overallScore: number;
  readonly findings: UXFinding[];
  readonly generatedAt: string;
}

export interface TokenCoverageReport {
  readonly colorsVerified: number;
  readonly colorsTotal: number;
  readonly typographyVerified: number;
  readonly typographyTotal: number;
  readonly spacingVerified: number;
  readonly spacingTotal: number;
  readonly radiusVerified: number;
  readonly radiusTotal: number;
  readonly elevationVerified: number;
  readonly elevationTotal: number;
  readonly score: number;
}

export interface AccessibilityCoverageReport {
  readonly rulesChecked: number;
  readonly rulesPassed: number;
  readonly rulesFailed: readonly string[];
  readonly score: number;
}

export interface ResponsiveCoverageReport {
  readonly breakpointsChecked: number;
  readonly breakpointsPassed: number;
  readonly breakpointsFailed: readonly string[];
  readonly score: number;
}

export interface UXFinding {
  readonly id: string;
  readonly type: 'token-mismatch' | 'accessibility-violation' | 'responsive-break' | 'missing-implementation';
  readonly severity: 'low' | 'medium' | 'high' | 'critical';
  readonly title: string;
  readonly description: string;
  readonly designId: string;
  readonly implId?: string;
  readonly expected: string;
  readonly actual: string;
}

/** The impl artifact shape we query. */
interface ImplArtifact {
  readonly attributes: Record<string, unknown>;
}

/** Real DesignTokenSet from design/types.ts (nested structure). */
interface RealDesignTokens extends DesignTokenSet {}

/** Real PageDesignDoc subset we need. */
interface RealPageDesignDoc {
  readonly designTokens?: RealDesignTokens;
  readonly accessibility?: ReadonlyArray<{ readonly guideline: string; readonly implementation: string }>;
  readonly responsive?: ReadonlyArray<{ readonly breakpointMin?: string; readonly behavior: string }>;
}

/** Extract the REAL nested token structure from the design doc. */
function extractRealTokensFromDesign(doc: RealPageDesignDoc): RealDesignTokens {
  return doc.designTokens ?? ({} as RealDesignTokens);
}

/**
 * Extract tokens from the IMPLEMENTATION artifact. The build layer now writes
 * a realized design surface at attributes['designTokens'] with a flat
 * `colors`/`typography`/`spacing`/`radius`/`elevation` record that matches
 * the structure the verifier compares against.
 */
function extractTokensFromImpl(impl: ImplArtifact): {
  colors: Record<string, string>;
  typography: Record<string, unknown>;
  spacing: Record<string, string>;
  radius: Record<string, string>;
  elevation: Record<string, string>;
} {
  const surface = (impl.attributes['designTokens'] as
    | { colors?: Record<string, string>; typography?: Record<string, unknown>; spacing?: Record<string, string>; radius?: Record<string, string>; elevation?: Record<string, string> }
    | undefined) ?? {};
  return {
    colors: surface.colors ?? {},
    typography: surface.typography ?? {},
    spacing: surface.spacing ?? {},
    radius: surface.radius ?? {},
    elevation: surface.elevation ?? {},
  };
}

/** Flatten the real nested color tokens to a flat record for comparison. */
function flattenRealColors(tokens: RealDesignTokens): Record<string, string> {
  const c = tokens.color;
  if (!c) return {};
  return {
    primary: c.primary ?? '',
    secondary: c.secondary ?? '',
    surface: c.surface ?? '',
    surfaceAlt: c.surfaceAlt ?? '',
    text: c.text ?? '',
    mutedText: c.mutedText ?? '',
    border: c.border ?? '',
    danger: c.danger ?? '',
    success: c.success ?? '',
    focus: c.focus ?? '',
    primaryHover: c.primaryHover ?? '',
    primaryPressed: c.primaryPressed ?? '',
    onPrimary: c.onPrimary ?? '',
    accent: c.accent ?? '',
    onAccent: c.onAccent ?? '',
    dangerHover: c.dangerHover ?? '',
    warning: c.warning ?? '',
    info: c.info ?? '',
    selected: c.selected ?? '',
    selectedText: c.selectedText ?? '',
    disabledBg: c.disabledBg ?? '',
    disabledText: c.disabledText ?? '',
  };
}

/** Flatten real nested typography tokens. */
function flattenRealTypography(tokens: RealDesignTokens): Record<string, unknown> {
  const t = tokens.typography;
  if (!t) return {};
  return {
    baseFontSize: t.baseFontSize,
    fontFamily: t.fontFamily,
    fallbackFamily: t.fallbackFamily,
    displaySize: t.display?.size,
    displayWeight: t.display?.weight,
    displayLineHeight: t.display?.lineHeight,
    headingSize: t.heading?.size,
    headingWeight: t.heading?.weight,
    headingLineHeight: t.heading?.lineHeight,
    bodySize: t.body?.size,
    bodyWeight: t.body?.weight,
    bodyLineHeight: t.body?.lineHeight,
    captionSize: t.caption?.size,
    captionWeight: t.caption?.weight,
    captionLineHeight: t.caption?.lineHeight,
  };
}

/** Flatten real nested spacing tokens. */
function flattenRealSpacing(tokens: RealDesignTokens): Record<string, string> {
  const s = tokens.spacing;
  if (!s) return {};
  return {
    unit: s.unit ?? '',
    pageMargin: s.pageMargin ?? '',
    controlGap: s.controlGap ?? '',
    sectionGap: s.sectionGap ?? '',
    componentGap: s.componentGap ?? '',
    density: s.density ?? '',
  };
}

/** Flatten real nested radius tokens. */
function flattenRealRadius(tokens: RealDesignTokens): Record<string, string> {
  const r = tokens.radius;
  if (!r) return {};
  return {
    unit: r.unit ?? '',
    control: r.control ?? '',
    card: r.card ?? '',
    modal: r.modal ?? '',
    surface: r.surface ?? '',
  };
}

/** Flatten real nested elevation tokens. */
function flattenRealElevation(tokens: RealDesignTokens): Record<string, string> {
  const e = tokens.elevation;
  if (!e) return {};
  return {
    unit: e.unit ?? '',
    level0: e.levels?.[0]?.shadow ?? '',
    level1: e.levels?.[1]?.shadow ?? '',
    level2: e.levels?.[2]?.shadow ?? '',
    level3: e.levels?.[3]?.shadow ?? '',
  };
}

function compareFlatRecords(
  design: Record<string, string | unknown>,
  impl: Record<string, string | unknown>,
  category: string,
): { verified: number; total: number; mismatches: { key: string; expected: string; actual: string }[] } {
  const keys = new Set([...Object.keys(design), ...Object.keys(impl)]);
  let verified = 0;
  const mismatches: { key: string; expected: string; actual: string }[] = [];

  for (const key of keys) {
    const expected = design[key];
    const actual = impl[key];
    if (expected !== undefined && actual !== undefined && String(expected) === String(actual)) {
      verified++;
    } else if (expected !== undefined && actual !== undefined) {
      mismatches.push({ key, expected: String(expected), actual: String(actual) });
    } else if (expected !== undefined) {
      mismatches.push({ key, expected: String(expected), actual: 'missing' });
    }
  }

  return { verified, total: Object.keys(design).length, mismatches };
}

function checkAccessibilityRules(design: RealPageDesignDoc, impl: ImplArtifact): {
  passed: number;
  total: number;
  failed: string[];
} {
  const rules = design.accessibility ?? [];
  const implA11y = (impl.attributes['accessibility'] as { passed?: string[]; failed?: string[] }) ?? {};

  let passed = 0;
  const failed: string[] = [];

  for (const rule of rules) {
    // The design uses `guideline`; the impl surface uses `passed` array of guideline strings.
    if (implA11y.passed?.includes(rule.guideline)) {
      passed++;
    } else {
      failed.push(`${rule.guideline}`);
    }
  }

  return { passed, total: rules.length, failed };
}

function checkResponsiveRules(design: RealPageDesignDoc, impl: ImplArtifact): {
  passed: number;
  total: number;
  failed: string[];
} {
  const rules = design.responsive ?? [];
  const implResponsive = (impl.attributes['responsive'] as { passed?: string[]; failed?: string[] }) ?? {};

  let passed = 0;
  const failed: string[] = [];

  for (const rule of rules) {
    // The design uses `{breakpointMin, behavior}`; the impl surface `passed` is strings like "768px: behavior"
    const ruleKey = `${rule.breakpointMin ?? 'base'}: ${rule.behavior}`;
    if (implResponsive.passed?.includes(ruleKey)) {
      passed++;
    } else {
      failed.push(ruleKey);
    }
  }

  return { passed, total: rules.length, failed };
}

export async function verifyUXAgainstImplementation(
  services: CoreServices,
  designResult: DesignRunResult,
  buildResult: BuildRunResult,
  _designCoverage: DesignCoverageAssessment,
  actor: Actor,
): Promise<UXVerificationResult> {
  const { store, graph } = services;
  const at = new Date().toISOString();
  const findings: UXFinding[] = [];
  let findingCounter = 0;

  // Get page design artifacts from design result
  const blueprintId = designResult.blueprintId ?? (() => { throw new Error('Design result missing blueprintId'); })();
  const blueprint = await store.require(blueprintId);
  const pageDesignIds = blueprint.attributes['pageDesignIds'] as readonly string[];

  // Get implementation artifacts from build result
  const manifestId = buildResult.manifestId ?? '';
  const implIds = buildResult.artifactIds.filter((id) => id !== manifestId);

  // Map design IDs to implementation IDs by base name
  const designToImpl = new Map<string, string>();
  for (const designId of pageDesignIds) {
    const base = designId.replace('-DESIGN', '');
    const implId = implIds.find((id) => id.startsWith(base + '-IMPL'));
    if (implId) designToImpl.set(designId, implId);
  }

  // Token coverage across all design-impl pairs
  let totalColors = 0, verifiedColors = 0;
  let totalTypography = 0, verifiedTypography = 0;
  let totalSpacing = 0, verifiedSpacing = 0;
  let totalRadius = 0, verifiedRadius = 0;
  let totalElevation = 0, verifiedElevation = 0;

  let totalA11yRules = 0, passedA11yRules = 0;
  const failedA11yRules: string[] = [];

  let totalResponsiveRules = 0, passedResponsiveRules = 0;
  const failedResponsiveRules: string[] = [];

  for (const [designId, implId] of designToImpl.entries()) {
    const designArtifact = await store.require(designId);
    const implArtifact = await store.require(implId);

    const designDoc = designArtifact.attributes['designDoc'] as RealPageDesignDoc;
    const realDesignTokens = extractRealTokensFromDesign(designDoc);
    const implFlatTokens = extractTokensFromImpl(implArtifact);

    // Flatten real nested design tokens for comparison
    const designColors = flattenRealColors(realDesignTokens);
    const designTypography = flattenRealTypography(realDesignTokens);
    const designSpacing = flattenRealSpacing(realDesignTokens);
    const designRadius = flattenRealRadius(realDesignTokens);
    const designElevation = flattenRealElevation(realDesignTokens);

    // Colors
    const colorsResult = compareFlatRecords(designColors, implFlatTokens.colors, 'colors');
    totalColors += colorsResult.total;
    verifiedColors += colorsResult.verified;
    for (const m of colorsResult.mismatches) {
      findings.push({
        id: `UXF-${String(++findingCounter).padStart(3, '0')}`,
        type: 'token-mismatch',
        severity: 'medium',
        title: `Color token mismatch: ${m.key}`,
        description: `Design specifies ${m.key}=${m.expected}, implementation has ${m.actual}`,
        designId,
        implId,
        expected: m.expected,
        actual: m.actual,
      });
    }

    // Typography
    const typoResult = compareFlatRecords(designTypography, implFlatTokens.typography, 'typography');
    totalTypography += typoResult.total;
    verifiedTypography += typoResult.verified;
    for (const m of typoResult.mismatches) {
      findings.push({
        id: `UXF-${String(++findingCounter).padStart(3, '0')}`,
        type: 'token-mismatch',
        severity: 'medium',
        title: `Typography token mismatch: ${m.key}`,
        description: `Design specifies ${m.key}=${m.expected}, implementation has ${m.actual}`,
        designId,
        implId,
        expected: m.expected,
        actual: m.actual,
      });
    }

    // Spacing
    const spacingResult = compareFlatRecords(designSpacing, implFlatTokens.spacing, 'spacing');
    totalSpacing += spacingResult.total;
    verifiedSpacing += spacingResult.verified;
    for (const m of spacingResult.mismatches) {
      findings.push({
        id: `UXF-${String(++findingCounter).padStart(3, '0')}`,
        type: 'token-mismatch',
        severity: 'low',
        title: `Spacing token mismatch: ${m.key}`,
        description: `Design specifies ${m.key}=${m.expected}, implementation has ${m.actual}`,
        designId,
        implId,
        expected: m.expected,
        actual: m.actual,
      });
    }

    // Radius
    const radiusResult = compareFlatRecords(designRadius, implFlatTokens.radius, 'radius');
    totalRadius += radiusResult.total;
    verifiedRadius += radiusResult.verified;
    for (const m of radiusResult.mismatches) {
      findings.push({
        id: `UXF-${String(++findingCounter).padStart(3, '0')}`,
        type: 'token-mismatch',
        severity: 'low',
        title: `Radius token mismatch: ${m.key}`,
        description: `Design specifies ${m.key}=${m.expected}, implementation has ${m.actual}`,
        designId,
        implId,
        expected: m.expected,
        actual: m.actual,
      });
    }

    // Elevation
    const elevationResult = compareFlatRecords(designElevation, implFlatTokens.elevation, 'elevation');
    totalElevation += elevationResult.total;
    verifiedElevation += elevationResult.verified;
    for (const m of elevationResult.mismatches) {
      findings.push({
        id: `UXF-${String(++findingCounter).padStart(3, '0')}`,
        type: 'token-mismatch',
        severity: 'low',
        title: `Elevation token mismatch: ${m.key}`,
        description: `Design specifies ${m.key}=${m.expected}, implementation has ${m.actual}`,
        designId,
        implId,
        expected: m.expected,
        actual: m.actual,
      });
    }

    // Accessibility
    const a11y = checkAccessibilityRules(designDoc, implArtifact);
    totalA11yRules += a11y.total;
    passedA11yRules += a11y.passed;
    for (const f of a11y.failed) {
      failedA11yRules.push(f);
      findings.push({
        id: `UXF-${String(++findingCounter).padStart(3, '0')}`,
        type: 'accessibility-violation',
        severity: 'high',
        title: `Accessibility rule not implemented: ${f}`,
        description: `Design requires ${f}, but implementation does not evidence compliance`,
        designId,
        implId,
        expected: f,
        actual: 'not implemented',
      });
    }

    // Responsive
    const responsive = checkResponsiveRules(designDoc, implArtifact);
    totalResponsiveRules += responsive.total;
    passedResponsiveRules += responsive.passed;
    for (const f of responsive.failed) {
      failedResponsiveRules.push(f);
      findings.push({
        id: `UXF-${String(++findingCounter).padStart(3, '0')}`,
        type: 'responsive-break',
        severity: 'medium',
        title: `Responsive rule not implemented: ${f}`,
        description: `Design requires ${f}, but implementation does not evidence compliance`,
        designId,
        implId,
        expected: f,
        actual: 'not implemented',
      });
    }
  }

  // Missing implementations
  for (const designId of pageDesignIds) {
    if (!designToImpl.has(designId)) {
      findings.push({
        id: `UXF-${String(++findingCounter).padStart(3, '0')}`,
        type: 'missing-implementation',
        severity: 'critical',
        title: `Missing implementation for design ${designId}`,
        description: `Page design ${designId} has no corresponding implementation artifact`,
        designId,
        expected: 'implementation artifact',
        actual: 'missing',
      });
    }
  }

  const tokenScore = totalColors + totalTypography + totalSpacing + totalRadius + totalElevation > 0
    ? (verifiedColors + verifiedTypography + verifiedSpacing + verifiedRadius + verifiedElevation) /
      (totalColors + totalTypography + totalSpacing + totalRadius + totalElevation)
    : 1;

  const a11yScore = totalA11yRules > 0 ? passedA11yRules / totalA11yRules : 1;
  const responsiveScore = totalResponsiveRules > 0 ? passedResponsiveRules / totalResponsiveRules : 1;

  const overallScore = (tokenScore + a11yScore + responsiveScore) / 3;

  // Persist UX verification as artifact
  const projectId = designResult.artifactIds.find((id: string) => id.startsWith('PROJECT-')) ?? 'unknown';
  const artifact = createArtifact({
    id: services.allocator.nextId('UX_VERIFICATION'),
    type: 'UX_VERIFICATION',
    title: 'Visual/UX Verification Report',
    projectId,
    actor,
    at,
    dependencies: [blueprintId, buildResult.manifestId ?? ''].filter(Boolean),
    attributes: {
      tokenCoverage: { colorsVerified: verifiedColors, colorsTotal: totalColors, typographyVerified: verifiedTypography, typographyTotal: totalTypography, spacingVerified: verifiedSpacing, spacingTotal: totalSpacing, radiusVerified: verifiedRadius, radiusTotal: totalRadius, elevationVerified: verifiedElevation, elevationTotal: totalElevation, score: tokenScore },
      accessibilityCoverage: { rulesChecked: totalA11yRules, rulesPassed: passedA11yRules, rulesFailed: failedA11yRules, score: a11yScore },
      responsiveCoverage: { breakpointsChecked: totalResponsiveRules, breakpointsPassed: passedResponsiveRules, breakpointsFailed: failedResponsiveRules, score: responsiveScore },
      overallScore,
      findings,
      generatedAt: at,
    },
  });
  await services.store.append(artifact);
  syncArtifactToGraph(services.graph, artifact);

  for (const finding of findings) {
    const fArtifact = createArtifact({
      id: services.allocator.nextId('UX_FINDING'),
      type: 'UX_FINDING',
      title: finding.title,
      projectId,
      actor,
      at,
      dependencies: [artifact.id],
      attributes: { ...finding },
    });
    await services.store.append(fArtifact);
    syncArtifactToGraph(services.graph, fArtifact);
    services.graph.link(artifact.id, 'CONTAINS', fArtifact.id);
  }

  return {
    projectId: projectId,
    tokenCoverage: { colorsVerified: verifiedColors, colorsTotal: totalColors, typographyVerified: verifiedTypography, typographyTotal: totalTypography, spacingVerified: verifiedSpacing, spacingTotal: totalSpacing, radiusVerified: verifiedRadius, radiusTotal: totalRadius, elevationVerified: verifiedElevation, elevationTotal: totalElevation, score: tokenScore },
    accessibilityCoverage: { rulesChecked: totalA11yRules, rulesPassed: passedA11yRules, rulesFailed: failedA11yRules, score: a11yScore },
    responsiveCoverage: { breakpointsChecked: totalResponsiveRules, breakpointsPassed: passedResponsiveRules, breakpointsFailed: failedResponsiveRules, score: responsiveScore },
    overallScore,
    findings,
    generatedAt: at,
  };
}