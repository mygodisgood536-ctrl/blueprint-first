/**
 * Unified Blueprint-First model catalogue.
 *
 * Aggregates normalized model information from multiple independent sources
 * (Models.dev, OpenRouter) into one deduplicated, searchable catalogue, and
 * applies explicitly proven access overrides from Blueprint-First's own
 * verified access mechanisms.
 *
 * Honesty rules enforced here:
 *  - Catalogue presence means a model EXISTS. It does NOT mean the model is
 *    usable by this user; a provider's `connectionVerified` carries that.
 *  - Source disagreement resolves CONSERVATIVELY: 'free_no_api_key' can only
 *    come from an explicit proven override, never inferred from catalogues.
 *  - One unavailable source degrades gracefully; verified results from the
 *    remaining sources are still served. Total failure surfaces as an error
 *    rather than a silently empty catalogue.
 */

import type { ModelInfo, ModelAccessCategory } from './provider-metadata.ts';
import { ModelsDevSource } from './models-dev-source.ts';
import { OpencodeCatalogueSource } from './opencode/opencode-catalogue-source.ts';
import { OpenRouterProvider } from './openrouter-provider.ts';

export interface ModelSearchQuery {
  readonly searchTerm?: string;
  readonly providerId?: string;
  readonly accessCategories?: readonly ModelAccessCategory[];
  readonly capabilities?: {
    readonly streaming?: boolean;
    readonly toolCalling?: boolean;
    readonly vision?: boolean;
    readonly reasoning?: boolean;
    readonly structuredOutput?: boolean;
  };
  /** Upper bound on USD-per-1M input price; null-priced models are excluded. */
  readonly maxInputCostPer1M?: number;
  /** Upper bound on USD-per-1M output price; null-priced models are excluded. */
  readonly maxOutputCostPer1M?: number;
  readonly contextLengthMin?: number;
  /**
   * Only include models that are CURRENTLY AVAILABLE.
   *
   * Availability is a catalogue fact, not a connection fact: a model is
   * available when the authoritative source that publishes it still publishes
   * it. That is a different question from whether a connection has been
   * VERIFIED, and the two are reported separately on purpose - a model can be
   * listed and still have no working credential behind it.
   */
  readonly availableOnly?: boolean;
  /**
   * Only include models whose provider connection is currently VERIFIED, i.e.
   * a real connection test succeeded. This is strictly stronger than
   * `availableOnly`.
   */
  readonly verifiedOnly?: boolean;
}

export interface ModelCatalogueEntry extends ModelInfo {
  /** Every source that reported this model (e.g. ["models.dev","openrouter"]). */
  readonly sources: readonly string[];
  /** Stable identity: "<providerId>:<modelId>". */
  readonly key: string;
  /**
   * True when Blueprint-First has verified the access route for this model
   * (its provider connection passed a real verification test). Catalogue
   * presence alone NEVER sets this.
   */
  readonly verified: boolean;
}

export interface ModelCatalogueSearchResult {
  readonly total: number;
  readonly models: readonly ModelCatalogueEntry[];
  readonly sources: readonly string[];
}

/**
 * Honest per-provider catalogue facts, computed from the merged sources.
 * `categories` lists every access category those models actually carry, so a
 * caller can classify the provider into Free/Subscription truthfully.
 */
export interface CatalogueProviderSummary {
  readonly name: string;
  readonly modelCount: number;
  readonly categories: readonly ModelAccessCategory[];
}

export interface ModelCatalogueStats {
  readonly totalModels: number;
  readonly byCategory: Record<ModelAccessCategory, number>;
  readonly byProvider: Record<string, number>;
  readonly byProviderInfo: Readonly<Record<string, CatalogueProviderSummary>>;
  readonly verifiedCount: number;
  readonly sourceCount: number;
}

export interface ModelCatalogueOptions {
  modelsDevSource?: ModelsDevSource;
  openRouterProvider?: OpenRouterProvider;
  /** Live catalogue from the installed opencode runtime (provider/models/prices). */
  opencodeSource?: OpencodeCatalogueSource;
  /**
   * Blueprint-First's own verified access overrides: models for which the
   * platform has PROVEN an access route (e.g. no-user-key). These override
   * any source classification; nothing else is ever reclassified.
   */
  accessOverrides?: readonly {
    readonly providerId: string;
    readonly modelId: string;
    readonly accessCategory: ModelAccessCategory;
  }[];
  /**
   * Authoritative AVAILABILITY for one provider, pushed by the provider itself.
   *
   * A catalogue says which models exist. Availability says which of them the
   * connected account can actually use right now - and that list changes on the
   * provider's schedule, not the platform's. When the overlay is present, a
   * model that the provider no longer publishes for this account is marked
   * unavailable, so it is never offered as a new selection.
   */
  availabilityOverlay?: {
    readonly providerId: string;
    /** Model ids the account can use. */
    readonly availableModelIds: ReadonlySet<string>;
    /** When the overlay was fetched, and whether it has expired. */
    readonly checkedAt: string;
    readonly expired: boolean;
  };
}

const CATEGORY_ORDER: Record<ModelAccessCategory, number> = {
  free_no_api_key: 0,
  free_api_key_required: 1,
  free_oauth: 2,
  platform_provided: 3,
  local: 4,
  paid: 5,
};

function matchesQuery(model: ModelCatalogueEntry, query: ModelSearchQuery): boolean {
  if (query.searchTerm !== undefined && query.searchTerm.length > 0) {
    const term = query.searchTerm.toLowerCase();
    const matches =
      model.name.toLowerCase().includes(term) ||
      model.modelId.toLowerCase().includes(term) ||
      model.providerName.toLowerCase().includes(term);
    if (!matches) return false;
  }
  if (query.providerId !== undefined && model.providerId !== query.providerId) return false;
  if (query.accessCategories !== undefined && query.accessCategories.length > 0) {
    if (!query.accessCategories.includes(model.accessCategory)) return false;
  }
  if (query.capabilities !== undefined) {
    const caps = query.capabilities;
    if (caps.streaming === true && !model.capabilities.streaming) return false;
    if (caps.toolCalling === true && !model.capabilities.toolCalling) return false;
    if (caps.vision === true && !model.capabilities.vision) return false;
    if (caps.reasoning === true && !model.capabilities.reasoning) return false;
    if (caps.structuredOutput === true && !model.capabilities.structuredOutput) return false;
  }
  if (query.maxInputCostPer1M !== undefined) {
    if (model.inputCostPer1M === null || model.inputCostPer1M > query.maxInputCostPer1M) return false;
  }
  if (query.maxOutputCostPer1M !== undefined) {
    if (model.outputCostPer1M === null || model.outputCostPer1M > query.maxOutputCostPer1M) return false;
  }
  if (query.contextLengthMin !== undefined && model.contextLength < query.contextLengthMin) return false;
  // Availability and verification are different facts and are filtered
  // separately. Filtering availability on verification - as this once did -
  // empties the catalogue, because a catalogue entry is never "verified" by
  // virtue of being listed.
  if (query.availableOnly === true && !model.available) return false;
  if (query.verifiedOnly === true && !model.verified) return false;
  return true;
}

/** Conservative merge: classification prefers the stricter proven category. */
function mergeInto(map: Map<string, ModelCatalogueEntry>, entry: ModelCatalogueEntry): void {
  const existing = map.get(entry.key);
  if (existing === undefined) {
    map.set(entry.key, entry);
    return;
  }
  const merged: ModelCatalogueEntry = {
    ...existing,
    // Stricter (earlier) category wins; overrides are applied afterwards.
    accessCategory:
      CATEGORY_ORDER[existing.accessCategory] <= CATEGORY_ORDER[entry.accessCategory]
        ? existing.accessCategory
        : entry.accessCategory,
    // If either source proves a price, the cheaper proven price is honest.
    inputCostPer1M: pickKnownPrice(existing.inputCostPer1M, entry.inputCostPer1M),
    outputCostPer1M: pickKnownPrice(existing.outputCostPer1M, entry.outputCostPer1M),
    contextLength: Math.max(existing.contextLength, entry.contextLength),
    maxOutputTokens: Math.max(existing.maxOutputTokens, entry.maxOutputTokens),
    capabilities: {
      streaming: existing.capabilities.streaming || entry.capabilities.streaming,
      toolCalling: existing.capabilities.toolCalling || entry.capabilities.toolCalling,
      vision: existing.capabilities.vision || entry.capabilities.vision,
      reasoning: existing.capabilities.reasoning || entry.capabilities.reasoning,
      structuredOutput: existing.capabilities.structuredOutput || entry.capabilities.structuredOutput,
    },
    sources: [...existing.sources, ...entry.sources.filter((s) => !existing.sources.includes(s))],
    verified: existing.verified || entry.verified,
    metadata: { ...entry.metadata, ...existing.metadata },
  };
  map.set(entry.key, merged);
}

function pickKnownPrice(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}

export class ModelCatalogue {
  private readonly modelsDevSource?: ModelsDevSource;
  private readonly openRouterProvider?: OpenRouterProvider;
  private readonly opencodeSource?: OpencodeCatalogueSource;
  private readonly accessOverrides: ReadonlyMap<string, ModelAccessCategory>;
  private availabilityOverlay?: NonNullable<ModelCatalogueOptions['availabilityOverlay']>;

  constructor(options: ModelCatalogueOptions = {}) {
    this.modelsDevSource = options.modelsDevSource;
    this.openRouterProvider = options.openRouterProvider;
    this.opencodeSource = options.opencodeSource;
    this.availabilityOverlay = options.availabilityOverlay;
    this.accessOverrides = new Map(
      (options.accessOverrides ?? []).map((o) => [
        `${o.providerId}:${o.modelId}`,
        o.accessCategory,
      ]),
    );
  }

  /**
   * Whether the platform's own OpenCode connection has been VERIFIED.
   *
   * Only then may a genuinely zero-cost OpenCode model be advertised as
   * needing no further key from the user. Before that, the platform can prove
   * the model exists and what it costs, but not that this deployment can reach
   * it - so the honest category is "free, but a key is required".
   */
  private openCodeConnectionVerified = false;

  /**
   * Records whether the platform's OpenCode connection is verified.
   *
   * This is the only thing that can promote a zero-cost model to
   * `free_no_api_key`: the vision requires that classification to come from a
   * PROVEN access route, never from a catalogue's own claim.
   */
  setOpenCodeConnectionVerified(verified: boolean): void {
    this.openCodeConnectionVerified = verified;
  }

  /**
   * Replaces the provider's own availability list.
   *
   * The catalogue is refreshed from the provider on a schedule, and this is how
   * a fresh list is applied without restarting anything. An EMPTY overlay is
   * not the same as no overlay: an empty set means the provider published
   * nothing for this account, which is a fact, and every model of that provider
   * is genuinely unavailable.
   */
  setAvailabilityOverlay(overlay: NonNullable<ModelCatalogueOptions['availabilityOverlay']>): void {
    this.availabilityOverlay = overlay;
  }

  /** The provider's current availability list, when one has been applied. */
  currentAvailabilityOverlay(): NonNullable<ModelCatalogueOptions['availabilityOverlay']> | null {
    return this.availabilityOverlay ?? null;
  }

  /** Stable identity for a model within the catalogue. */
  static modelKey(providerId: string, modelId: string): string {
    return `${providerId}:${modelId}`;
  }

  /**
   * Aggregates all configured sources. Returns the merged, deduplicated
   * catalogue sorted by access category then name. Throws only when every
   * configured source failed (graceful degradation when at least one works).
   */
  async getAllModels(): Promise<readonly ModelCatalogueEntry[]> {
    const map = new Map<string, ModelCatalogueEntry>();
    let succeeded = 0;
    let attempted = 0;
    let lastError: unknown = null;

    if (this.modelsDevSource !== undefined) {
      attempted++;
      try {
        const models = await this.modelsDevSource.fetchCatalog();
        succeeded++;
        for (const m of models) {
          mergeInto(map, {
            ...m,
            key: ModelCatalogue.modelKey(m.providerId, m.modelId),
            sources: ['models.dev'],
            verified: false, // a third-party catalogue never proves accessibility
          });
        }
      } catch (error) {
        lastError = error;
      }
    }

    if (this.openRouterProvider !== undefined) {
      attempted++;
      try {
        const models = await this.openRouterProvider.listModels();
        succeeded++;
        // verified reflects the provider's REAL last connection test only.
        const verified = this.openRouterProvider.connectionVerified;
        for (const m of models) {
          mergeInto(map, {
            ...m,
            key: ModelCatalogue.modelKey(m.providerId, m.modelId),
            sources: ['openrouter'],
            verified,
          });
        }
      } catch (error) {
        lastError = error;
      }
    }

    if (this.opencodeSource !== undefined) {
      attempted++;
      try {
        const models = await this.opencodeSource.fetchCatalog();
        succeeded++;
        // The runtime's own models are free-without-key ONLY once the provider
        // holds a real connection test (free_no_api_key is a platform proof).
        const verified = this.opencodeSource.verified;
        for (const m of models) {
          mergeInto(map, {
            ...m,
            key: ModelCatalogue.modelKey(m.providerId, m.modelId),
            sources: ['opencode'],
            verified,
          });
        }
      } catch (error) {
        lastError = error;
      }
    }

    if (attempted > 0 && succeeded === 0) {
      throw lastError instanceof Error
        ? lastError
        : new Error('All configured model catalogue sources failed.');
    }

    // Apply Blueprint-First's own proven access overrides last: they always
    // win over any third-party source classification.
    //
    // The provider's own availability list is applied AFTER that, because
    // availability is a fact ABOUT THE ACCOUNT, not a classification: a model
    // the provider still publishes but no longer offers to this account must be
    // marked unavailable even though a catalogue lists it.
    const overlay = this.availabilityOverlay;
    return [...map.values()]
      .map((entry) => {
        const override = this.accessOverrides.get(entry.key);
        let classified = override === undefined ? entry : { ...entry, accessCategory: override };
        // A genuinely zero-cost OpenCode model becomes "no key needed" ONLY
        // once the platform's own OpenCode connection is verified. Until then
        // the honest category is "free, but a key is required" - the price is
        // known, the access route is not.
        if (
          classified.providerId === 'opencode' &&
          classified.accessCategory === 'free_api_key_required' &&
          this.openCodeConnectionVerified &&
          classified.inputCostPer1M === 0 &&
          classified.outputCostPer1M === 0
        ) {
          classified = { ...classified, accessCategory: 'free_no_api_key' };
        }
        if (overlay === undefined || classified.providerId !== overlay.providerId) return classified;
        const available = overlay.availableModelIds.has(classified.modelId);
        return {
          ...classified,
          available,
          metadata: {
            ...classified.metadata,
            ...(available
              ? { availabilitySource: 'provider-account', availabilityCheckedAt: overlay.checkedAt }
              : {
                  availabilitySource: 'provider-account',
                  availabilityCheckedAt: overlay.checkedAt,
                  availabilityExpired: overlay.expired,
                }),
          },
        };
      })
      .sort((a, b) => {
        const byCategory = CATEGORY_ORDER[a.accessCategory] - CATEGORY_ORDER[b.accessCategory];
        if (byCategory !== 0) return byCategory;
        return a.name.localeCompare(b.name);
      });
  }

  async search(query: ModelSearchQuery = {}): Promise<ModelCatalogueSearchResult> {
    const all = await this.getAllModels();
    const filtered = all.filter((m) => matchesQuery(m, query));
    return {
      total: filtered.length,
      models: filtered,
      sources: [...new Set(filtered.flatMap((m) => m.sources))],
    };
  }

  async getModelsByCategory(category: ModelAccessCategory): Promise<readonly ModelCatalogueEntry[]> {
    const result = await this.search({ accessCategories: [category] });
    return result.models;
  }

  async getModel(providerId: string, modelId: string): Promise<ModelCatalogueEntry | null> {
    const all = await this.getAllModels();
    return all.find((m) => m.providerId === providerId && m.modelId === modelId) ?? null;
  }

  async getStats(): Promise<ModelCatalogueStats> {
    const all = await this.getAllModels();
    const byCategory = Object.fromEntries(
      Object.keys(CATEGORY_ORDER).map((k) => [k as ModelAccessCategory, 0]),
    ) as Record<ModelAccessCategory, number>;
    const byProvider: Record<string, number> = {};
    const byProviderBuild: Record<string, { name: string; modelCount: number; categories: ModelAccessCategory[] }> = {};
    let verifiedCount = 0;
    for (const m of all) {
      byCategory[m.accessCategory] = (byCategory[m.accessCategory] ?? 0) + 1;
      byProvider[m.providerId] = (byProvider[m.providerId] ?? 0) + 1;
      let info = byProviderBuild[m.providerId];
      if (info === undefined) {
        info = { name: m.providerName || m.providerId, modelCount: 0, categories: [] };
        byProviderBuild[m.providerId] = info;
      }
      info.modelCount++;
      if (!info.categories.includes(m.accessCategory)) {
        info.categories.push(m.accessCategory);
      }
      if (m.verified) verifiedCount++;
    }
    const byProviderInfo: Readonly<Record<string, CatalogueProviderSummary>> = byProviderBuild;
    return {
      totalModels: all.length,
      byCategory,
      byProvider,
      byProviderInfo,
      verifiedCount,
      sourceCount: new Set(all.flatMap((m) => m.sources)).size,
    };
  }
}
