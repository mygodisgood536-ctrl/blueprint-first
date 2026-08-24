/**
 * AI Design Studio contract (roadmap Level 1a).
 *
 * Input: discovery output. Output: an approvable blueprint - page designs
 * decomposed into sections/content/actions/states with validation and rules,
 * each as traceable artifacts feeding the Knowledge Graph.
 *
 * STATUS: scaffolded (next implementation stage after the foundation batch).
 */

import { ScaffoldedEngine } from './scaffold.ts';
import type { EngineDescriptor } from './scaffold.ts';
import type { DiscoveryOutput } from './product-discovery-engine.ts';

export interface BlueprintSection {
  title: string;
  contentType: string;
  actions: readonly string[];
}

export interface BlueprintPage {
  title: string;
  purpose: string;
  sections: readonly BlueprintSection[];
}

export interface BlueprintOutput {
  productName: string;
  pages: readonly BlueprintPage[];
  assumptionsCarriedForward: readonly string[];
}

export interface AiDesignStudio {
  readonly descriptor: EngineDescriptor;
  designBlueprint(discovery: DiscoveryOutput): Promise<BlueprintOutput>;
}

export class ScaffoldedAiDesignStudio extends ScaffoldedEngine implements AiDesignStudio {
  constructor() {
    super({ name: 'AiDesignStudio', targetLevel: '1a', status: 'scaffolded' });
  }

  async designBlueprint(_discovery: DiscoveryOutput): Promise<BlueprintOutput> {
    this.refuse('designBlueprint');
  }
}
