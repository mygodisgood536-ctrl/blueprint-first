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
  /** Only include models whose provider connection is currently verified. */
  readonly availableOnly?: boolean;
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
  if (query.availableOnly === true && !model.verified) return false;
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

  constructor(options: ModelCatalogueOptions = {}) {
    this.modelsDevSource = options.modelsDevSource;
    this.openRouterProvider = options.openRouterProvider;
    this.opencodeSource = options.opencodeSource;
    this.accessOverrides = new Map(
      (options.accessOverrides ?? []).map((o) => [
        `${o.providerId}:${o.modelId}`,
        o.accessCategory,
      ]),
    );
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
    return [...map.values()]
      .map((entry) => {
        const override = this.accessOverrides.get(entry.key);
        return override === undefined ? entry : { ...entry, accessCategory: override };
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
