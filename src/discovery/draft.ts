/** The draft a discovery worker produces and hands to verification. */

import type { NormalizedInventory } from './normalize.ts';
import type { DiscoveryBaseline } from './materialize.ts';

export interface DiscoveryDraft {
  readonly inventory: NormalizedInventory;
  readonly baseline: DiscoveryBaseline;
  /** sha256 of the raw AI response content (evidence anchor). */
  readonly responseSha256: string;
}
