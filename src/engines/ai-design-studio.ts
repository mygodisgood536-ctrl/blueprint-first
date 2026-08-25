/**
 * AI Design Studio - Level 1a contract.
 *
 * IMPLEMENTED by src/design/studio.ts (AiDesignStudio): consumes a VERIFIED
 * discovery baseline, derives an approvable blueprint deterministically from
 * stored artifacts, enriches with evidence-anchored AI rationales, verifies
 * independently, and exposes the approval gate (src/design/approval.ts).
 */

import type { EngineDescriptor } from './scaffold.ts';
import type { DiscoveryBaseline } from '../discovery/materialize.ts';
import type { DesignRunResult } from '../design/studio.ts';

export interface AiDesignStudio {
  readonly descriptor: EngineDescriptor;
  designFromBaseline(baseline: DiscoveryBaseline): Promise<DesignRunResult>;
}

export type { DesignRunResult } from '../design/studio.ts';
