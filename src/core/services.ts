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

export interface CoreServices {
  readonly store: ArtifactStore;
  readonly allocator: ArtifactIdAllocator;
  readonly graph: KnowledgeGraph;
  readonly evidence: EvidenceLog;
  readonly router: AiRouter;
  readonly logger?: Logger;
}
