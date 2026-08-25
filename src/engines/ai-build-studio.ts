/**
 * AI Build Studio - Level 1a contract.
 *
 * IMPLEMENTED by src/build/studio.ts (AiBuildStudio): consumes an APPROVED
 * blueprint artifact id, derives the implementation package deterministically
 * from approved design docs plus the certified inventory (api/entity/
 * integration units), enriches page implementations with evidence-anchored AI
 * notes through the router, verifies independently across all eleven
 * dimensions, and materializes -IMPL lineage artifacts aggregated by a
 * COMPONENT implementation manifest.
 */

import type { EngineDescriptor } from './scaffold.ts';
import type { BuildRunResult } from '../build/types.ts';

export interface AiBuildStudio {
  readonly descriptor: EngineDescriptor;
  buildFromBlueprint(blueprintId: string): Promise<BuildRunResult>;
}

export type { BuildRunResult, ImplementationUnit } from '../build/types.ts';
