/**
 * Single-pass Product Discovery Engine contract (roadmap Level 1a).
 *
 * Input: a raw product brief. Output: a first-pass discovery result covering
 * candidate pages/features, assumptions and open questions - the seed of the
 * Application Knowledge Graph for a new product.
 *
 * STATUS: scaffolded. The full implementation (Discovery Worker Corps,
 * Understanding + Structural clusters, self/specialist verification) is the
 * next implementation stage after this foundation batch.
 */

import { ScaffoldedEngine } from './scaffold.ts';
import type { EngineDescriptor } from './scaffold.ts';

export interface DiscoveryPageCandidate {
  title: string;
  purpose: string;
  candidateFeatures: readonly string[];
}

export interface DiscoveryOutput {
  productName: string;
  pages: readonly DiscoveryPageCandidate[];
  assumptions: readonly string[];
  openQuestions: readonly string[];
}

export interface ProductDiscoveryEngine {
  readonly descriptor: EngineDescriptor;
  discover(brief: string): Promise<DiscoveryOutput>;
}

export class ScaffoldedProductDiscoveryEngine extends ScaffoldedEngine implements ProductDiscoveryEngine {
  constructor() {
    super({ name: 'ProductDiscoveryEngine', targetLevel: '1a', status: 'scaffolded' });
  }

  async discover(_brief: string): Promise<DiscoveryOutput> {
    this.refuse('discover');
  }
}
