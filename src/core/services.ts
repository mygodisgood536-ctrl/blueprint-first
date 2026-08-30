/**
 * Shared service bundle handed to engines and pipelines.
 *
 * Engines never construct their own infrastructure; they receive these
 * services so every stage (discovery, design, build) operates on the same
 * allocator, stores, graph, evidence log, and AI router - which is what keeps
 * IDs continuous, provenance unified, and traceability intact across stages.
 */

import type { ArtifactIdAllocator } from './id-allocator.ts';
import type { ArtifactStore } from './store.ts';
import type { KnowledgeGraph } from './graph.ts';
import type { EvidenceLog } from '../verification/evidence.ts';
import type { AiRouter } from '../ai/router.ts';
import type { Logger } from './logging.ts';
import type { ProjectRegistry } from '../project/registry.ts';

export interface CoreServices {
  readonly store: ArtifactStore;
  readonly allocator: ArtifactIdAllocator;
  readonly graph: KnowledgeGraph;
  readonly evidence: EvidenceLog;
  readonly router: AiRouter;
  readonly logger?: Logger;
  /**
   * Optional structured project registry (see project/registry.ts). Present
   * where project identity/mode/scoping is in use; absent (undefined) in legacy
   * paths that predate the project foundation or that operate without a
   * ProjectRegistry. Optional so existing constructions remain valid.
   */
  readonly projects?: ProjectRegistry;
}
