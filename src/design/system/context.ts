/**
 * Project-specific design context derivation (visual/product design capability).
 *
 * Extracts a machine-evaluable characterization of WHAT the product is and WHO
 * it is for from the verified business model + discovery baseline. This context
 * is the (project-specific) input to visual-identity derivation — it is never a
 * global/static theme. Two different projects with different names/entities/
 * roles/features derive different identities.
 */

import type { BusinessModel } from '../../discovery/business-model.ts';
import type { DiscoveryBaseline } from '../../discovery/materialize.ts';

/** Broad product kind inferred from the project's own vocabulary. */
export type DesignDomain =
  | 'finance'
  | 'healthcare'
  | 'creative'
  | 'logistics'
  | 'education'
  | 'commerce'
  | 'operations'
  | 'social';

export interface ProjectDesignContext {
  readonly projectId: string;
  readonly productName: string;
  readonly domain: DesignDomain;
  /** How much product surface we have; drives richness (e.g. component budget). */
  readonly surfaceScale: 'minimal' | 'standard' | 'large';
  /** Primary "temperature" of interaction: read/relaxed vs. action-heavy/urgent. */
  readonly energy: 'calm' | 'balanced' | 'high';
  /** Influence of sensitive data (PII/financial/health) on the visual tone. */
  readonly sensitivity: 'standard' | 'regulated';
  /** Free-text reasoning recorded (not trusted as structure; a rationale field). */
  readonly rationale: string;
}

const DOMAIN_KEYWORDS: Readonly<Record<DesignDomain, readonly string[]>> = {
  finance: ['billing', 'invoice', 'payment', 'ledger', 'account', 'budget', 'credit', 'wallet', 'pay', 'currency'],
  healthcare: ['patient', 'appointment', 'clinic', 'record', 'diagnosis', 'prescription', 'health', 'care', 'medic'],
  creative: ['campaign', 'asset', 'creative', 'portfolio', 'design', 'content', 'brand', 'editorial', 'story'],
  logistics: ['shipment', 'inventory', 'order', 'warehouse', 'carrier', 'fleet', 'tracking', 'dispatch', 'route'],
  education: ['course', 'lesson', 'student', 'curriculum', 'grade', 'class', 'quiz', 'learning', 'enrollment'],
  commerce: ['product', 'cart', 'catalog', 'checkout', 'store', 'customer', 'promotion', 'merchant', 'sku'],
  operations: ['task', 'project', 'workflow', 'board', 'ticket', 'team', 'sprint', 'backlog', 'squad'],
  social: ['post', 'feed', 'comment', 'profile', 'follow', 'network', 'message', 'community', 'group'],
};

/** Sensitivity signals run against the project's own entity/feature vocabulary. */
const SENSITIVITY_KEYWORDS: readonly string[] = [
  'billing', 'invoice', 'payment', 'ledger', 'card', 'patient', 'record',
  'diagnosis', 'prescription', 'social-security', 'ssn', 'health',
];

function inferDomainTokens(terms: readonly string[]): Readonly<Record<DesignDomain, number>> {
  const scores: Record<DesignDomain, number> = {
    finance: 0, healthcare: 0, creative: 0, logistics: 0,
    education: 0, commerce: 0, operations: 0, social: 0,
  };
  for (const term of terms) {
    const low = term.toLowerCase();
    for (const domain of Object.keys(DOMAIN_KEYWORDS) as DesignDomain[]) {
      const hit = DOMAIN_KEYWORDS[domain].some((k) => low.includes(k));
      if (hit) scores[domain] += 1;
    }
  }
  return scores;
}

function collectVocabulary(baseline: DiscoveryBaseline): readonly string[] {
  const words: string[] = [];
  for (const group of [
    baseline.entities, baseline.features, baseline.workflows,
    baseline.modules, baseline.integrations, baseline.apis,
  ] as const) {
    for (const entry of group) {
      const key = entry.key.replace(/[-_]/g, ' ').toLowerCase();
      words.push(key);
      for (const seg of key.split(' ')) if (seg.length > 1) words.push(seg);
    }
  }
  return words;
}

function productNameFromBaseline(baseline: DiscoveryBaseline): string {
  // Prefer an ENTITY/PAGE that reads like a product token; otherwise the first module.
  const first = baseline.modules[0];
  if (baseline.modules.length > 0 && first !== undefined) return first.key;
  return baseline.projectId;
}

/**
 * Derive the project-specific design context from the verified business model
 * and discovery baseline. This is deterministic and purely driven by the
 * project's own artifacts — no global theme is involved. The business model is
 * optional enrichment; identity is still fully project-specific from the
 * baseline vocabulary alone when it is absent.
 */
export function deriveProjectDesignContext(
  baseline: DiscoveryBaseline,
  businessModel?: BusinessModel | null,
): ProjectDesignContext {
  const vocabulary = [
    ...collectVocabulary(baseline),
    ...(businessModel?.roles ?? []),
    ...(businessModel?.entities ?? []).flatMap((e) => [e.name, e.key, ...e.fields.map((f) => f.name)]),
    ...(businessModel?.workflows ?? []).flatMap((w) => [w.key, w.title]),
    ...(businessModel?.features ?? []).flatMap((f) => [f.key, f.title]),
  ];

  const scores = inferDomainTokens(vocabulary);
  let domain: DesignDomain = 'operations';
  let best = -1;
  for (const d of Object.keys(scores) as DesignDomain[]) {
    if (scores[d] > best) {
      best = scores[d];
      domain = d;
    }
  }

  const sensitive = SENSITIVITY_KEYWORDS.some((k) => vocabulary.some((v) => v.toLowerCase().includes(k)));
  const sensitivity: 'standard' | 'regulated' = sensitive ? 'regulated' : 'standard';

  const entityCount = businessModel?.entities.length ?? 0;
  const featureCount = businessModel?.features.length ?? 0;
  const pageCount = baseline.pages.length;
  const surfaceTotal = entityCount + featureCount + pageCount;
  const surfaceScale = surfaceTotal >= 18 ? 'large' : surfaceTotal >= 8 ? 'standard' : 'minimal';

  // Energy weights action-oriented vocabulary that implies frequent mutation.
  const actionTerms = vocabulary.filter((v) =>
    ['create', 'assign', 'submit', 'approve', 'checkout', 'book', 'ship', 'buy', 'chat', 'post'].some((a) => v.includes(a)),
  ).length;
  const energy = actionTerms >= 6 ? 'high' : actionTerms >= 2 ? 'balanced' : 'calm';

  const rationale =
    `Derived from project "$${productNameFromBaseline(baseline)}" — domain="${domain}" ` +
    `(matched on project vocabulary: ${vocabulary.length} token(s), top scorer), ` +
    `sensitivity=${sensitivity}, surfaceScale=${surfaceScale} ` +
    `(${entityCount} entities / ${featureCount} features / ${pageCount} pages), ` +
    `energy=${energy}. Identity is project-specific: no global theme is applied.`;

  return {
    projectId: baseline.projectId,
    productName: productNameFromBaseline(baseline),
    domain,
    surfaceScale,
    energy,
    sensitivity,
    rationale,
  };
}
