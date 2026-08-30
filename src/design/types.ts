/**
 * Design domain types - Level 1a AI Design Studio.
 *
 * The studio consumes the VERIFIED discovery baseline from the store/graph
 * (never re-discovers) and produces design documents plus lineage artifacts:
 *
 *   PAGE-0001   -> PAGE-0001-DESIGN
 *   FEATURE-0001-> FEATURE-0001-DESIGN
 *   (aggregated by)  BLUEPRINT-0001
 *
 * Structural design content is derived deterministically from the certified
 * inventory so the blueprint can never silently contradict discovery. An AI
 * model contributes a clearly-labeled design rationale per page through the
 * router; its output is recorded as evidence, not trusted as structure.
 */

export interface LayoutItem {
  readonly sectionKey: string;
  readonly title: string;
  readonly contentType: string;
  readonly layoutHint: string;
}

export interface InteractionItem {
  readonly actionArtifactId: string;
  readonly actionKey: string;
  readonly title: string;
  readonly outcome: string;
  readonly validationMessages: readonly string[];
}

export interface StateHandlingItem {
  readonly stateArtifactId: string;
  readonly name: string;
  readonly whenVisible: string;
}

export interface SecurityNote {
  readonly permissionKey: string;
  readonly resource: string;
  readonly roles: readonly string[];
  readonly appliesHere: boolean;
}

// --- Structured visual / design-token foundation (expansion §8-9) -----------
// These are structured, machine-evaluable fields on the design document, NOT a
// separate design system. They let the design-coverage assessment produce
// concrete evidence instead of relying on free-text assertions. All fields are
// optional so previously-stored design docs remain valid shapes.

export interface DesignColorTokens {
  readonly scheme?: 'light' | 'dark';
  readonly primary?: string;
  readonly primaryHover?: string;
  readonly primaryPressed?: string;
  readonly primaryDisabled?: string;
  readonly onPrimary?: string;
  readonly accent?: string;
  readonly onAccent?: string;
  readonly secondary?: string;
  readonly surface?: string;
  readonly surfaceAlt?: string;
  readonly surfaceContrast?: string;
  readonly text?: string;
  readonly mutedText?: string;
  readonly border?: string;
  readonly danger?: string;
  readonly dangerHover?: string;
  readonly warning?: string;
  readonly success?: string;
  readonly info?: string;
  readonly focus?: string;
  readonly selected?: string;
  readonly selectedText?: string;
  readonly disabledBg?: string;
  readonly disabledText?: string;
}

export interface DesignTypographyTokenScale {
  readonly family?: string;
  readonly fallback?: string;
  readonly size?: string;
  readonly weight?: string;
  readonly lineHeight?: string;
  readonly letterSpacing?: string;
}

export interface DesignTypographyTokens {
  readonly baseFontSize?: string;
  readonly fontFamily?: string;
  readonly fallbackFamily?: string;
  readonly display?: DesignTypographyTokenScale;
  readonly heading?: DesignTypographyTokenScale;
  readonly body?: DesignTypographyTokenScale;
  readonly caption?: DesignTypographyTokenScale;
}

export interface DesignSpacingTokens {
  readonly unit?: string;
  readonly scale?: readonly string[];
  readonly pageMargin?: string;
  readonly controlGap?: string;
  readonly sectionGap?: string;
  readonly componentGap?: string;
  readonly density?: 'compact' | 'comfortable' | 'relaxed';
}

export interface DesignRadiusTokens {
  readonly unit?: string;
  readonly control?: string;
  readonly card?: string;
  readonly modal?: string;
  readonly surface?: string;
}

export interface DesignElevationLevel {
  readonly level: number;
  readonly shadow: string;
}

export interface DesignElevationTokens {
  readonly unit?: string;
  readonly levels?: readonly DesignElevationLevel[];
}

export interface DesignLayoutTokens {
  readonly gridColumns?: number;
  readonly columnGap?: string;
  readonly rowGap?: string;
  readonly maxWidth?: string;
  readonly container?: string;
  readonly alignment?: string;
}

export interface DesignMotionTokens {
  readonly durationQuick?: string;
  readonly durationStandard?: string;
  readonly durationSlow?: string;
  readonly easingStandard?: string;
  readonly easingEnter?: string;
  readonly easingExit?: string;
  readonly reducedMotion?: boolean;
}

export interface DesignTokenSet {
  readonly color?: DesignColorTokens;
  readonly typography?: DesignTypographyTokens;
  readonly spacing?: DesignSpacingTokens;
  readonly radius?: DesignRadiusTokens;
  readonly elevation?: DesignElevationTokens;
  readonly layout?: DesignLayoutTokens;
  readonly motion?: DesignMotionTokens;
}

export interface DesignVariant {
  readonly key: string;
  /** Component/section the variant applies to (empty = page-wide). */
  readonly appliedTo?: string;
  readonly notes?: string;
}

export interface ResponsiveRule {
  /** Optional minimum viewport width the rule engages at. */
  readonly breakpointMin?: string;
  readonly behavior: string;
}

export interface AccessibilityRule {
  readonly guideline: string;
  readonly implementation: string;
}

export interface PageDesignDoc {
  readonly pageArtifactId: string;
  readonly pageKey: string;
  readonly title: string;
  readonly purpose: string;
  readonly moduleId: string;
  readonly navigation: {
    readonly inMainNav: boolean;
    readonly route: string;
    readonly label: string;
  };
  readonly layout: readonly LayoutItem[];
  readonly interactions: readonly InteractionItem[];
  readonly stateHandling: readonly StateHandlingItem[];
  readonly functionalRequirements: readonly string[];
  readonly nonFunctionalRequirements: readonly string[];
  readonly dataNotes: string;
  readonly apiNotes: string;
  readonly securityNotes: readonly SecurityNote[];
  readonly constraints: string;
  /** Structured design tokens (color/typography/spacing/radius/elevation). */
  readonly designTokens?: DesignTokenSet;
  /** Variants of the design (e.g. alternate layouts per contextual state). */
  readonly variants?: readonly DesignVariant[];
  /** Structured responsive behavior rules. */
  readonly responsive?: readonly ResponsiveRule[];
  /** Structured accessibility rules with concrete implementation. */
  readonly accessibility?: readonly AccessibilityRule[];
  /** Deeper design generation (expansion §12): iconography. */
  readonly iconography?: readonly { readonly key: string; readonly purpose?: string }[];
  /** Deeper design generation (expansion §12): imagery. */
  readonly imagery?: readonly { readonly key: string; readonly purpose?: string; readonly source?: 'placeholder' | 'derived' }[];
  /** Deeper design generation (expansion §12): notification/feedback states. */
  readonly notificationStates?: readonly { readonly kind: string; readonly title: string; readonly tone?: string }[];
  /** Deeper design generation (expansion §12): derived runtime quality states. */
  readonly runtimeStates?: readonly { readonly name: string; readonly description: string }[];
  /** Project-specific visual identity (visual/product design capability). */
  readonly visualIdentity?: {
    readonly tone: string;
    readonly seedHue: number;
    readonly directionNote: string;
    readonly rationale: string;
  };
  /** Which design-system components this page uses (by component key). */
  readonly usesComponents?: readonly string[];
  /** Per-page visual specification (hierarchy, focal point, actions, states). */
  readonly visualSpec?: {
    readonly visualHierarchy: readonly string[];
    readonly focalPoint: string;
    readonly primaryAction: string;
    readonly secondaryActions: readonly string[];
    readonly headerTreatment: string;
    readonly responsiveStrategy: string;
    readonly loadingStrategy: string;
    readonly emptyState: string;
    readonly errorState: string;
  };
  /** Per-page icon + imagery plan (project-specific). */
  readonly assetPlan?: {
    readonly icons: readonly string[];
    readonly images: readonly { readonly slot: string; readonly style: string }[];
  };
  readonly aiRationale?: string;
}

export interface FeatureDesignDoc {
  readonly featureArtifactId: string;
  readonly featureKey: string;
  readonly title: string;
  readonly description: string;
  readonly pageKeys: readonly string[];
  readonly workflowSteps: readonly { readonly workflowKey: string; readonly steps: readonly string[] }[];
}

export interface BlueprintPackage {
  readonly projectId: string;
  readonly pageDesigns: readonly PageDesignDoc[];
  readonly featureDesigns: readonly FeatureDesignDoc[];
}
