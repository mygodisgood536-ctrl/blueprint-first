/**
 * Product Discovery Engine - Level 1a contract.
 *
 * IMPLEMENTED by src/discovery/engine.ts (SinglePassDiscoveryEngine): a
 * single-pass pipeline that turns a Product Understanding Brief into a
 * verified, graph-registered discovery baseline.
 *
 * The multi-worker Discovery Department (worker corps, independent
 * reconstruction boss, red team) remains a later-level extension of this same
 * seam - see docs/roadmap.md.
 */

import type { EngineDescriptor } from './scaffold.ts';
import type { ProductUnderstandingBrief } from '../discovery/types.ts';
import type { DiscoveryRunResult } from '../discovery/engine.ts';

export interface ProductDiscoveryEngine {
  readonly descriptor: EngineDescriptor;
  discover(brief: ProductUnderstandingBrief): Promise<DiscoveryRunResult>;
}

export type {
  ProductUnderstandingBrief,
  RawDiscoveryResult,
  DiscoveryKey,
} from '../discovery/types.ts';
export type { DiscoveryRunResult } from '../discovery/engine.ts';

