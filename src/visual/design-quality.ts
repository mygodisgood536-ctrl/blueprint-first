/**
 * Design quality + consistency assessment (visual/product design capability).
 *
 * Assesses visual coherence, hierarchy, balance, color harmony, component
 * consistency, interaction clarity, responsive quality, accessibility,
 * perceived performance, visual density, identity-specificity, and absence
 * of generic appearance. Also detects cross-page inconsistencies with
 * intentional-exception support.
 *
 * Mapped to the existing EvidenceLog/COVERAGE path — NOT a new authority.
 */

import type { EvidenceLog } from '../verification/evidence.ts';
import type { Actor } from '../core/artifact.ts';
import type { PageDesignDoc } from '../design/types.ts';
import type { VisualDesignSystem } from '../design/system/visual-system.ts';

export interface DesignQualityAssessment {
  readonly projectId: string;
  readonly coherence: number;            // 0-1: overall visual coherence
  readonly hierarchy: number;            // 0-1: clear visual hierarchy
  readonly balance: number;              // 0-1: visual balance/weight distribution
  readonly colorHarmony: number;         // 0-1: palette harmony & contrast
  readonly componentConsistency: number; // 0-1: component spec adherence
  readonly interactionClarity: number;   // 0-1: interaction feedback completeness
  readonly responsiveQuality: number;    // 0-1: responsive behavior quality
  readonly accessibility: number;        // 0-1: a11y rule completeness
  readonly perceivedPerformance: number; // 0-1: motion/loading/efficiency
  readonly visualDensity: number;        // 0-1: appropriate density
  readonly identitySpecificity: number;  // 0-1: project-specific (not generic)
  readonly overallScore: number;         // average of above
  readonly findings: DesignQualityFinding[];
}

export interface DesignQualityFinding {
  readonly id: string;
  readonly category: keyof Omit<DesignQualityAssessment, 'projectId' | 'overallScore' | 'findings'>;
  readonly severity: 'info' | 'warning' | 'error';
  readonly message: string;
  readonly pageKey?: string;
  readonly exception?: string; // intentional exception rationale
}

export interface DesignConsistencyReport {
  readonly projectId: string;
  readonly tokenConsistency: ConsistencyCheck;
  readonly componentConsistency: ConsistencyCheck;
  readonly spacingConsistency: ConsistencyCheck;
  readonly typographyConsistency: ConsistencyCheck;
  readonly interactionConsistency: ConsistencyCheck;
  readonly responsiveConsistency: ConsistencyCheck;
  readonly accessibilityConsistency: ConsistencyCheck;
  readonly exceptions: readonly ConsistencyException[];
  readonly overallConsistency: number; // 0-1
}

export interface ConsistencyCheck {
  readonly dimension: string;
  readonly consistent: boolean;
  readonly variance: number; // 0-1
  readonly details: string;
}

export interface ConsistencyException {
  readonly pageKey: string;
  readonly dimension: string;
  readonly rationale: string;
}

interface PageTokens {
  color: { primary: string; text: string; border: string };
  typography: { displaySize: string; headingSize: string; bodySize: string };
  spacing: { unit: string; pageMargin: string; controlGap: string };
}

/** Assess overall design quality of a project's page designs. */
export function assessDesignQuality(
  projectId: string,
  pageDesigns: readonly PageDesignDoc[],
  visual: VisualDesignSystem,
): DesignQualityAssessment {
  const findings: DesignQualityFinding[] = [];
  let findingId = 0;

  // 1. Coherence: do pages share the same visual identity?
  const identity = visual.identity.direction.tone;
  const coherence = pageDesigns.every((p) => p.visualIdentity?.tone === identity) ? 1 : 0.6;
  if (coherence < 1) findings.push(makeFinding('coherence', 'warning', `Pages have divergent visual identities (expected "${identity}")`));

  // 2. Hierarchy: do pages have structured visualHierarchy in visualSpec?
  const hasHierarchy = pageDesigns.every((p) => p.visualSpec?.visualHierarchy?.length ?? 0 > 0);
  const hierarchy = hasHierarchy ? 1 : 0.5;
  if (!hasHierarchy) findings.push(makeFinding('hierarchy', 'warning', 'Some pages lack visual hierarchy specification'));

  // 3. Balance: check primary/secondary action distribution
  const actionCounts = pageDesigns.map((p) => (p.visualSpec?.secondaryActions?.length ?? 0) + 1); // +1 for primary
  const avgActions = actionCounts.reduce((a, b) => a + b, 0) / actionCounts.length;
  const balance = avgActions >= 1 && avgActions <= 4 ? 1 : 0.7;
  if (avgActions > 4) findings.push(makeFinding('balance', 'warning', `Average ${avgActions.toFixed(1)} actions/page may overwhelm`));

  // 4. Color harmony: derived identity ensures harmony; check contrast
  const palette = visual.tokens.color;
  const hasContrast = palette && palette.primary && palette.text && palette.surface && palette.onPrimary;
  const colorHarmony = hasContrast ? 1 : 0.6;
  if (!hasContrast) findings.push(makeFinding('colorHarmony', 'warning', 'Derived palette missing key contrast pairs'));

  // 5. Component consistency: do pages use components from the system?
  const componentKeys = visual.components.inventoried;
  const pageComponents = new Set(pageDesigns.flatMap((p) => p.usesComponents ?? []));
  const undefinedComponents = [...pageComponents].filter((c) => !componentKeys.includes(c));
  const componentConsistency = undefinedComponents.length === 0 ? 1 : Math.max(0.4, 1 - undefinedComponents.length * 0.15);
  if (undefinedComponents.length > 0) findings.push(makeFinding('componentConsistency', 'warning', `Pages reference ${undefinedComponents.length} undefined component(s): ${undefinedComponents.join(', ')}`));

  // 6. Interaction clarity: check runtimeStates + notificationStates + variant coverage
  const hasLoading = pageDesigns.every((p) => (p.runtimeStates ?? []).some((s) => s.name === 'loading'));
  const hasEmpty = pageDesigns.every((p) => (p.runtimeStates ?? []).some((s) => s.name === 'empty'));
  const hasDisabled = pageDesigns.every((p) => (p.variants ?? []).some((v) => v.key.includes('disabled')));
  const hasMotion = pageDesigns.every((p) => (p.variants ?? []).some((v) => v.key.includes('motion')));
  const interactionClarity = [hasLoading, hasEmpty, hasDisabled, hasMotion].filter(Boolean).length / 4;
  if (!hasLoading) findings.push(makeFinding('interactionClarity', 'info', 'Some pages lack loading runtime state'));
  if (!hasEmpty) findings.push(makeFinding('interactionClarity', 'info', 'Some pages lack empty runtime state'));
  if (!hasDisabled) findings.push(makeFinding('interactionClarity', 'info', 'Some pages lack disabled-controls variant'));
  if (!hasMotion) findings.push(makeFinding('interactionClarity', 'info', 'Some pages lack motion-feedback variant'));

  // 7. Responsive quality: structured breakpoints, not just a sentence
  const hasStructuredResponsive = pageDesigns.every((p) =>
    (p.responsive ?? []).some((r) => r.breakpointMin && r.behavior.length > 20),
  );
  const responsiveQuality = hasStructuredResponsive ? 1 : 0.5;
  if (!hasStructuredResponsive) findings.push(makeFinding('responsiveQuality', 'warning', 'Some pages lack structured responsive breakpoints'));

  // 8. Accessibility: concrete WCAG rules per page
  const hasConcreteA11y = pageDesigns.every((p) =>
    (p.accessibility ?? []).some((r) => r.guideline.includes('WCAG') && r.implementation.length > 30),
  );
  const accessibility = hasConcreteA11y ? 1 : 0.6;
  if (!hasConcreteA11y) findings.push(makeFinding('accessibility', 'warning', 'Some pages lack concrete WCAG implementation details'));

  // 9. Perceived performance: motion tokens present, reduced-motion supported
  const motion = visual.tokens.motion;
  const hasMotionBudget = !!(motion?.durationQuick && motion?.durationStandard && motion?.durationSlow && motion?.reducedMotion);
  const perceivedPerformance = hasMotionBudget ? 1 : 0.7;
  if (!hasMotionBudget) findings.push(makeFinding('perceivedPerformance', 'info', 'Motion budget or reduced-motion not fully specified'));

  // 10. Visual density: spacing scale present, density mode set
  const spacing = visual.tokens.spacing;
  const hasDensity = (spacing?.scale?.length ?? 0) >= 4 && !!spacing?.density;
  const visualDensity = hasDensity ? 1 : 0.7;
  if (!hasDensity) findings.push(makeFinding('visualDensity', 'info', 'Spacing scale or density mode incomplete'));

  // 11. Identity specificity: rationale recorded, not generic
  const hasRationale = pageDesigns.every((p) => p.aiRationale && p.aiRationale.length > 50 && !p.aiRationale.includes('generic'));
  const identitySpecificity = hasRationale ? 1 : 0.4;
  if (!hasRationale) findings.push(makeFinding('identitySpecificity', 'warning', 'Design rationale is missing, generic, or too brief'));

  const scores = [coherence, hierarchy, balance, colorHarmony, componentConsistency, interactionClarity, responsiveQuality, accessibility, perceivedPerformance, visualDensity, identitySpecificity];
  const overallScore = scores.reduce((a, b) => a + b, 0) / scores.length;

  return { projectId, coherence, hierarchy, balance, colorHarmony, componentConsistency, interactionClarity, responsiveQuality, accessibility, perceivedPerformance, visualDensity, identitySpecificity, overallScore, findings };

  function makeFinding(
    category: DesignQualityFinding['category'],
    severity: DesignQualityFinding['severity'],
    message: string,
    pageKey?: string,
  ): DesignQualityFinding {
    return { id: `DQF-${String(++findingId).padStart(3, '0')}`, category, severity, message, pageKey };
  }
}

/** Assess cross-page design consistency with intentional-exception support. */
export function assessDesignConsistency(
  projectId: string,
  pageDesigns: readonly PageDesignDoc[],
  visual: VisualDesignSystem,
  exceptions: readonly ConsistencyException[] = [],
): DesignConsistencyReport {
  const pageTokens = pageDesigns.map((p) => extractPageTokens(p));

  // Token consistency: all pages share the same color primary, text, border
  const tokenConsistency = checkTokenConsistency(pageTokens);
  // Component consistency: all pages use components from the system
  const componentConsistency = checkComponentConsistency(pageDesigns, visual);
  // Spacing consistency: unit, pageMargin, controlGap
  const spacingConsistency = checkSpacingConsistency(pageTokens);
  // Typography consistency: display/heading/body sizes
  const typographyConsistency = checkTypographyConsistency(pageTokens);
  // Interaction consistency: runtimeStates coverage
  const interactionConsistency = checkInteractionConsistency(pageDesigns);
  // Responsive consistency: structured breakpoints
  const responsiveConsistency = checkResponsiveConsistency(pageDesigns);
  // Accessibility consistency: WCAG rules per page
  const accessibilityConsistency = checkAccessibilityConsistency(pageDesigns);

  const checks = [tokenConsistency, componentConsistency, spacingConsistency, typographyConsistency, interactionConsistency, responsiveConsistency, accessibilityConsistency];
  const overallConsistency = checks.reduce((a, c) => a + (c.consistent ? 1 : 1 - c.variance), 0) / checks.length;

  return {
    projectId,
    tokenConsistency,
    componentConsistency,
    spacingConsistency,
    typographyConsistency,
    interactionConsistency,
    responsiveConsistency,
    accessibilityConsistency,
    exceptions,
    overallConsistency,
  };
}

function extractPageTokens(doc: PageDesignDoc): PageTokens {
  const c = doc.designTokens?.color ?? {};
  const t = doc.designTokens?.typography ?? {};
  const s = doc.designTokens?.spacing ?? {};
  return {
    color: { primary: c.primary ?? '', text: c.text ?? '', border: c.border ?? '' },
    typography: { displaySize: t.display?.size ?? '', headingSize: t.heading?.size ?? '', bodySize: t.body?.size ?? '' },
    spacing: { unit: s.unit ?? '', pageMargin: s.pageMargin ?? '', controlGap: s.controlGap ?? '' },
  };
}

function checkTokenConsistency(pages: readonly PageTokens[]): ConsistencyCheck {
  if (pages.length <= 1) return { dimension: 'token', consistent: true, variance: 0, details: 'Single page' };
  const first = pages[0];
  if (!first) return { dimension: 'token', consistent: true, variance: 0, details: 'Empty' };
  const primary = first.color.primary;
  const text = first.color.text;
  const border = first.color.border;
  const mismatches = pages.filter((p) => p.color.primary !== primary || p.color.text !== text || p.color.border !== border).length;
  const variance = mismatches / pages.length;
  return { dimension: 'token', consistent: mismatches === 0, variance, details: mismatches === 0 ? 'All pages share identical color tokens' : `${mismatches}/${pages.length} pages diverge on primary/text/border` };
}

function checkComponentConsistency(pages: readonly PageDesignDoc[], visual: VisualDesignSystem): ConsistencyCheck {
  const valid = new Set(visual.components.inventoried);
  const allComponents = new Set(pages.flatMap((p) => p.usesComponents ?? []));
  const invalid = [...allComponents].filter((c) => !valid.has(c));
  const variance = invalid.length > 0 ? invalid.length / Math.max(1, allComponents.size) : 0;
  return { dimension: 'component', consistent: invalid.length === 0, variance, details: invalid.length === 0 ? 'All pages use only defined components' : `Pages reference ${invalid.length} undefined component(s)` };
}

function checkSpacingConsistency(pages: readonly PageTokens[]): ConsistencyCheck {
  if (pages.length <= 1) return { dimension: 'spacing', consistent: true, variance: 0, details: 'Single page' };
  const first = pages[0];
  if (!first) return { dimension: 'spacing', consistent: true, variance: 0, details: 'Empty' };
  const unit = first.spacing.unit;
  const pageMargin = first.spacing.pageMargin;
  const controlGap = first.spacing.controlGap;
  const mismatches = pages.filter((p) => p.spacing.unit !== unit || p.spacing.pageMargin !== pageMargin || p.spacing.controlGap !== controlGap).length;
  const variance = mismatches / pages.length;
  return { dimension: 'spacing', consistent: mismatches === 0, variance, details: mismatches === 0 ? 'All pages share identical spacing tokens' : `${mismatches}/${pages.length} pages diverge on spacing` };
}

function checkTypographyConsistency(pages: readonly PageTokens[]): ConsistencyCheck {
  if (pages.length <= 1) return { dimension: 'typography', consistent: true, variance: 0, details: 'Single page' };
  const first = pages[0];
  if (!first) return { dimension: 'typography', consistent: true, variance: 0, details: 'Empty' };
  const display = first.typography.displaySize;
  const heading = first.typography.headingSize;
  const body = first.typography.bodySize;
  const mismatches = pages.filter((p) => p.typography.displaySize !== display || p.typography.headingSize !== heading || p.typography.bodySize !== body).length;
  const variance = mismatches / pages.length;
  return { dimension: 'typography', consistent: mismatches === 0, variance, details: mismatches === 0 ? 'All pages share identical typography scales' : `${mismatches}/${pages.length} pages diverge on typography scale` };
}

function checkInteractionConsistency(pages: readonly PageDesignDoc[]): ConsistencyCheck {
  const required = ['loading', 'empty'];
  const missing = pages.filter((p) => required.some((r) => !(p.runtimeStates ?? []).some((s) => s.name === r))).length;
  const variance = missing / pages.length;
  return { dimension: 'interaction', consistent: missing === 0, variance, details: missing === 0 ? 'All pages define loading/empty runtime states' : `${missing}/${pages.length} pages missing required runtime states` };
}

function checkResponsiveConsistency(pages: readonly PageDesignDoc[]): ConsistencyCheck {
  const hasStructured = pages.every((p) => (p.responsive ?? []).some((r) => r.breakpointMin && r.behavior.length > 20));
  return { dimension: 'responsive', consistent: hasStructured, variance: hasStructured ? 0 : 1, details: hasStructured ? 'All pages have structured responsive rules' : 'Some pages lack structured breakpoints' };
}

function checkAccessibilityConsistency(pages: readonly PageDesignDoc[]): ConsistencyCheck {
  const hasConcrete = pages.every((p) => (p.accessibility ?? []).some((r) => r.guideline.includes('WCAG') && r.implementation.length > 30));
  return { dimension: 'accessibility', consistent: hasConcrete, variance: hasConcrete ? 0 : 1, details: hasConcrete ? 'All pages have concrete WCAG rules' : 'Some pages lack concrete accessibility rules' };
}

/** Record design quality + consistency assessments as evidence on the existing EvidenceLog. */
export async function recordDesignQualityEvidence(
  evidence: EvidenceLog,
  quality: DesignQualityAssessment,
  consistency: DesignConsistencyReport,
  options: { readonly producerId: string; readonly projectId: string; readonly pageDesignIds: readonly string[] },
): Promise<{ quality: DesignQualityAssessment; consistency: DesignConsistencyReport }> {
  const at = new Date().toISOString();

  // Quality evidence
  await evidence.append({
    kind: 'inspection',
    summary:
      `Design quality assessed: overall ${(quality.overallScore * 100).toFixed(0)}% ` +
      `(coherence ${(quality.coherence * 100).toFixed(0)}%, hierarchy ${(quality.hierarchy * 100).toFixed(0)}%, ` +
      `balance ${(quality.balance * 100).toFixed(0)}%, colorHarmony ${(quality.colorHarmony * 100).toFixed(0)}%, ` +
      `componentConsistency ${(quality.componentConsistency * 100).toFixed(0)}%, interactionClarity ${(quality.interactionClarity * 100).toFixed(0)}%, ` +
      `responsiveQuality ${(quality.responsiveQuality * 100).toFixed(0)}%, accessibility ${(quality.accessibility * 100).toFixed(0)}%, ` +
      `perceivedPerformance ${(quality.perceivedPerformance * 100).toFixed(0)}%, visualDensity ${(quality.visualDensity * 100).toFixed(0)}%, ` +
      `identitySpecificity ${(quality.identitySpecificity * 100).toFixed(0)}%) ` +
      `${quality.findings.length} finding(s).`,
    artifactIds: [options.projectId, ...options.pageDesignIds],
    payloadRef: `sha256:${Buffer.from(JSON.stringify(quality)).toString('base64').slice(0, 32)}`,
    producer: { kind: 'system', id: options.producerId },
    at,
  });

  // Consistency evidence
  await evidence.append({
    kind: 'inspection',
    summary:
      `Design consistency assessed: overall ${(consistency.overallConsistency * 100).toFixed(0)}% ` +
      `(token ${(1 - consistency.tokenConsistency.variance) * 100}%, component ${(1 - consistency.componentConsistency.variance) * 100}%, ` +
      `spacing ${(1 - consistency.spacingConsistency.variance) * 100}%, typography ${(1 - consistency.typographyConsistency.variance) * 100}%, ` +
      `interaction ${(1 - consistency.interactionConsistency.variance) * 100}%, responsive ${(1 - consistency.responsiveConsistency.variance) * 100}%, ` +
      `accessibility ${(1 - consistency.accessibilityConsistency.variance) * 100}%) ` +
      `${consistency.exceptions.length} intentional exception(s).`,
    artifactIds: [options.projectId, ...options.pageDesignIds],
    payloadRef: `sha256:${Buffer.from(JSON.stringify(consistency)).toString('base64').slice(0, 32)}`,
    producer: { kind: 'system', id: options.producerId },
    at,
  });

  return { quality, consistency };
}