/**
 * Digital Twin (§1.4, §T.1–3) domain types.
 *
 * The twin is a machine-evaluable simulation of the designed product: every
 * page, every interactive element, is bound to the DESIGN artifact that
 * realizes it and, from there, to the Discovery artifact and evidence that
 * produced it (§1.4: "Every element inside the twin is clickable back to its
 * DESIGN- artifact and, from there, to the Discovery artifact and evidence
 * that produced it"). Nothing in the twin is invented — it is derived from the
 * certified discovery inventory, the design package, and the evidence log.
 */

export type TwinElementKind =
  | 'section'
  | 'action'
  | 'state'
  | 'validation'
  | 'content'
  | 'requirement';

export interface TwinTraceStep {
  readonly artifactId: string;
  readonly kind: 'discovery' | 'design' | 'evidence';
  readonly label: string;
}

export interface TwinElement {
  /** Stable twin-side element id (`${pageId}#${kind}:${discoveryArtifactId}`). */
  readonly id: string;
  readonly kind: TwinElementKind;
  readonly label: string;
  readonly surface: string;
  readonly discoveryArtifactId: string;
  readonly designArtifactId: string | null;
  /** True when the design doc realizes this element (§T.2 binding check). */
  readonly designBound: boolean;
  readonly evidenceIds: readonly string[];
  readonly trace: readonly TwinTraceStep[];
}

export interface TwinGap {
  readonly severity: 'warning' | 'error';
  readonly message: string;
  readonly pageId: string;
  readonly artifactId?: string;
}

export interface TwinEdge {
  readonly from: string;
  readonly to: string;
  readonly relation: string;
}

export interface TwinPage {
  readonly pageId: string;
  readonly pageKey: string;
  readonly title: string;
  readonly designId: string | null;
  readonly designBound: boolean;
  readonly elements: readonly TwinElement[];
  readonly edges: readonly TwinEdge[];
  readonly gaps: readonly TwinGap[];
}

export interface DigitalTwin {
  readonly projectId: string;
  readonly blueprintId: string | null;
  /** Manifest artifact carrying the twin snapshot in the store. */
  readonly twinArtifactId: string;
  readonly pages: readonly TwinPage[];
  readonly elementCount: number;
  /** Elements the design package actually realizes (§T.2). */
  readonly boundElementCount: number;
  readonly gapCount: number;
  readonly evidenceCount: number;
  readonly built: boolean;
  readonly note: string;
}