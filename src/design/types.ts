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
