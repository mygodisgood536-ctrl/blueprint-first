/**
 * OpenCode catalogue source - a ModelCatalogue source backed by the REAL
 * installed opencode runtime's own catalogue state.
 *
 * Model presence, pricing and capability flags come from the runtime cache
 * (`opencode models`), never from a hard-coded copy. When the runtime is not
 * available / has no catalogue, fetchCatalog() throws so ModelCatalogue's
 * graceful per-source degradation reports it honestly instead of silently
 * emptying the catalogue.
 */

import type { ModelInfo } from '../provider-metadata.ts';
import type { OpenCodeProvider } from './opencode-provider.ts';
import { OpenCodeError } from './opencode-runtime.ts';

export interface OpencodeCatalogueSourceOptions {
  provider: OpenCodeProvider;
}

export class OpencodeCatalogueSource {
  private readonly provider: OpenCodeProvider;

  constructor(options: OpencodeCatalogueSourceOptions) {
    this.provider = options.provider;
  }

  get providerId(): string {
    return this.provider.id;
  }

  /** True when the underlying provider holds a real, current connection test. */
  get verified(): boolean {
    return this.provider.info.connectionVerified;
  }

  /** Live models from the real runtime catalogue (existence-only; NOT verified). */
  async fetchCatalog(): Promise<readonly ModelInfo[]> {
    try {
      return await this.provider.listModels();
    } catch (error) {
      if (error instanceof OpenCodeError) throw error;
      throw new OpenCodeError(
        `The OpenCode catalogue is unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}