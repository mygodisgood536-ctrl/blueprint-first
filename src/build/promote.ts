/** Status promotion for a materialized implementation package. */

import type { CoreServices } from '../core/services.ts';
import type { Actor } from '../core/artifact.ts';
import { recordStatusChange } from '../core/store.ts';
import type { BuildMaterializationResult } from './materialize.ts';

export async function promoteImplementationPackage(
  services: CoreServices,
  materialization: BuildMaterializationResult,
  to: 'VERIFIED' | 'CHANGES_REQUESTED',
  actor: Actor,
  note: string,
): Promise<void> {
  for (const id of [...materialization.allArtifactIds]) {
    await recordStatusChange(services.store, id, 'IN_REVIEW', actor, {
      note: 'Submitted for build verification.',
    });
    await recordStatusChange(services.store, id, to, actor, { note });
  }
}