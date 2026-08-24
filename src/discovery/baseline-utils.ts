/** Shared helpers over a materialized discovery baseline. */

import type { CoreServices } from '../core/services.ts';
import type { Actor } from '../core/artifact.ts';
import { recordStatusChange } from '../core/store.ts';
import type { DiscoveryBaseline } from './materialize.ts';

export function artifactIdsOf(baseline: DiscoveryBaseline): string[] {
  return [
    baseline.projectId,
    ...baseline.modules,
    ...baseline.features,
    ...baseline.workflows,
    ...baseline.pages,
    ...baseline.rules,
    ...baseline.permissions,
    ...baseline.entities,
    ...baseline.apis,
    ...baseline.integrations,
  ].map((entry) => (typeof entry === 'string' ? entry : entry.artifactId));
}

/**
 * Moves every artifact in the baseline through DRAFT -> IN_REVIEW -> target.
 * The transition path is enforced by the state machine at every step; the
 * acting actor and rationale are recorded in provenance.
 */
export async function promoteBaseline(
  services: CoreServices,
  ids: readonly string[],
  to: 'VERIFIED' | 'CHANGES_REQUESTED',
  actor: Actor,
  note: string,
): Promise<void> {
  for (const id of ids) {
    await recordStatusChange(services.store, id, 'IN_REVIEW', actor, {
      note: 'Submitted for discovery verification.',
    });
    await recordStatusChange(services.store, id, to, actor, { note });
  }
}
