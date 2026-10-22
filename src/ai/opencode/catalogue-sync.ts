/**
 * Provider catalogue synchronisation.
 *
 * The catalogue the platform shows is PUSHED by the provider, not frozen in the
 * repository. This service keeps the platform's view of "what can actually be
 * used right now" in step with the provider, and is honest about the state of
 * that view:
 *
 *   - a successful sync records WHEN it was fetched and when it expires;
 *   - a failed sync keeps the previous data but marks it EXPIRED, so a stale
 *     list is never presented as freshly verified availability;
 *   - the provider's own failure (unauthorized, rate limit, network) is
 *     reported with its real reason instead of being swallowed.
 *
 * The credential lives in the platform's secret boundary. Nothing secret is
 * stored here, and nothing secret is returned to a client.
 */

import type { OpenCodeConsoleProvider } from './opencode-console-provider.ts';
import type { OpenCodeConsoleFailure } from './opencode-console.ts';

/** How long a fetched catalogue is treated as current. */
export const DEFAULT_CATALOGUE_TTL_MS = 15 * 60 * 1000;

export type CatalogueSyncState = 'never-synced' | 'current' | 'expired' | 'failed';

export interface CatalogueSyncStatus {
  readonly state: CatalogueSyncState;
  /** When the current data was fetched, or null if it never was. */
  readonly syncedAt: string | null;
  /** When the current data expires, or null if it never was fetched. */
  readonly expiresAt: string | null;
  /** Model ids the account can use, or null when the list is unknown. */
  readonly availableModelIds: readonly string[] | null;
  /** The provider's real failure reason, when there was one. */
  readonly failure: OpenCodeConsoleFailure | null;
  /** Actionable, secret-free explanation of the last failure. */
  readonly detail: string | null;
  /** Whether the data currently held has expired. */
  readonly expired: boolean;
}

const NEVER: CatalogueSyncStatus = {
  state: 'never-synced',
  syncedAt: null,
  expiresAt: null,
  availableModelIds: null,
  failure: null,
  detail: null,
  expired: true,
};

export class CatalogueSync {
  private readonly provider: OpenCodeConsoleProvider;
  private readonly ttlMs: number;
  private status: CatalogueSyncStatus = NEVER;
  private inFlight: Promise<CatalogueSyncStatus> | null = null;

  constructor(options: { provider: OpenCodeConsoleProvider; ttlMs?: number }) {
    this.provider = options.provider;
    this.ttlMs = options.ttlMs ?? DEFAULT_CATALOGUE_TTL_MS;
  }

  /** The current status, including whether the data has expired. */
  current(): CatalogueSyncStatus {
    return this.status;
  }

  /**
   * True when the held data is still within its expiry window.
   *
   * A caller that needs to trust availability MUST check this: a catalogue
   * that cannot be refreshed is still usable, but it is no longer current.
   */
  isFresh(): boolean {
    if (this.status.expiresAt === null) return false;
    return Date.parse(this.status.expiresAt) > Date.now();
  }

  /**
   * Fetches the provider's catalogue, or returns the current data when it is
   * still fresh.
   *
   * `force` bypasses the freshness check, which is what an explicit user
   * refresh asks for.
   */
  async sync(options: { force?: boolean } = {}): Promise<CatalogueSyncStatus> {
    if (this.inFlight !== null) return await this.inFlight;
    if (!options.force && this.isFresh()) return this.status;
    this.inFlight = this.performSync();
    try {
      return await this.inFlight;
    } finally {
      this.inFlight = null;
    }
  }

  private async performSync(): Promise<CatalogueSyncStatus> {
    const result = await this.provider.fetchAccountCatalogue();
    const now = new Date();
    if (!result.ok) {
      // The previously held data is kept, but it is marked EXPIRED: a stale
      // list presented as fresh availability is exactly the failure this
      // service exists to prevent.
      const previous = this.status;
      this.status = {
        state: 'failed',
        syncedAt: previous.syncedAt,
        expiresAt: previous.expiresAt,
        availableModelIds: previous.availableModelIds,
        failure: result.failure,
        detail: result.detail,
        expired: true,
      };
      return this.status;
    }
    const expiresAt = new Date(now.getTime() + this.ttlMs).toISOString();
    this.status = {
      state: 'current',
      syncedAt: now.toISOString(),
      expiresAt,
      availableModelIds: result.models.map((m: { id: string }) => m.id),
      failure: null,
      detail: null,
      expired: false,
    };
    return this.status;
  }
}
