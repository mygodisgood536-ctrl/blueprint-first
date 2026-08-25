/** Status promotion for a materialized design package. */

import type { CoreServices } from '../core/services.ts';
import type { Actor } from '../core/artifact.ts';
import { recordStatusChange } from '../core/store.ts';
import type { DesignMaterializationResult } from './materialize.ts';

export async function promoteDesignPackage(
  services: CoreServices,
  materialization: DesignMaterializationResult,
  to: 'VERIFIED' | 'CHANGES_REQUESTED',
  actor: Actor,
  note: string,
): Promise<void> {
  const ids = [
    ...materialization.pageDesignIds,
    ...materialization.featureDesignIds,
    materialization.blueprintId,
  ];
  for (const id of ids) {
    await recordStatusChange(services.store, id, 'IN_REVIEW', actor, {
      note: 'Submitted for design verification.',
    });
    await recordStatusChange(services.store, id, to, actor, { note });
  }
}
