/**
 * AI Build Studio contract (roadmap Level 1a).
 *
 * Input: an approved blueprint (artifact graph). Output: an implementation
 * plan + generated implementation artifacts, each linked to its design origin
 * via DERIVED_FROM so design-to-code traceability holds from day one.
 *
 * STATUS: scaffolded.
 */

import { ScaffoldedEngine } from './scaffold.ts';
import type { EngineDescriptor } from './scaffold.ts';

export interface ImplementationUnit {
  /** Base artifact ID this unit implements, e.g. PAGE-0001. */
  artifactId: string;
  kind: 'component' | 'api' | 'entity' | 'integration' | 'content';
  description: string;
}

export interface BuildOutput {
  units: readonly ImplementationUnit[];
  notes: string[];
}

export interface ApprovedBlueprintRef {
  /** Artifact IDs constituting the approved blueprint. */
  artifactIds: readonly string[];
  approvedBy: string;
  approvalEvidenceId?: string;
}

export interface AiBuildStudio {
  readonly descriptor: EngineDescriptor;
  build(blueprint: ApprovedBlueprintRef): Promise<BuildOutput>;
}

export class ScaffoldedAiBuildStudio extends ScaffoldedEngine implements AiBuildStudio {
  constructor() {
    super({ name: 'AiBuildStudio', targetLevel: '1a', status: 'scaffolded' });
  }

  async build(_blueprint: ApprovedBlueprintRef): Promise<BuildOutput> {
    this.refuse('build');
  }
}
