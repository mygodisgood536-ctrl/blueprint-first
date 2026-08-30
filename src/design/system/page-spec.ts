/**
 * Per-page visual specification builder (visual/product design capability).
 *
 * Produces a page-specific, machine-evaluable visual specification — visual
 * hierarchy, focal point, primary/secondary actions, header treatment, and
 * per-state (loading/empty/error/success) strategies — plus the page's asset
 * plan and the component-system pieces it uses. Derived from the page's own
 * layout, interactions and state model rather than a generic page template.
 */

import type { PageDesignDoc } from '../types.ts';
import type { ProjectDesignContext } from './context.ts';

export interface PageVisualSpec {
  readonly pageKey: string;
  readonly visualHierarchy: readonly string[];
  readonly focalPoint: string;
  readonly primaryAction: string;
  readonly secondaryActions: readonly string[];
  readonly headerTreatment: string;
  readonly responsiveStrategy: string;
  readonly loadingStrategy: string;
  readonly emptyState: string;
  readonly errorState: string;
}

const KNOWN_CONTENT: Readonly<Record<string, string>> = {
  form: 'form',
  list: 'list',
  grid: 'grid',
  table: 'table',
  dashboard: 'dashboard',
  graph: 'chart',
  chart: 'chart',
  stats: 'stats',
  detail: 'detail',
  search: 'search',
  editor: 'editor',
  profile: 'profile',
  settings: 'settings',
};

function classifyContent(layout: readonly { readonly sectionKey: string; readonly title: string; readonly contentType: string; readonly layoutHint: string }[]): string {
  const counts = new Map<string, number>();
  for (const item of layout) {
    const k = item.contentType.toLowerCase();
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let best = 'content';
  let bestCount = 0;
  for (const [k, n] of counts.entries()) {
    const label = KNOWN_CONTENT[k] ?? k;
    if (n > bestCount) {
      bestCount = n;
      best = label;
    }
  }
  return best;
}

export function buildPageVisualSpec(
  doc: PageDesignDoc,
  context: ProjectDesignContext,
): PageVisualSpec {
  const contentKind = classifyContent(doc.layout);
  const isEditorial = contentKind === 'detail' || contentKind === 'dashboard' || contentKind === 'stats';
  const isFormHeavy = contentKind === 'form' || contentKind === 'settings' || contentKind === 'profile';
  const isCollection = contentKind === 'list' || contentKind === 'table' || contentKind === 'grid' || contentKind === 'search';

  const primaryAction = isFormHeavy
    ? 'Primary "Save" button in the page footer and dialogs (label reflects the action)'
    : isCollection
      ? 'Primary "Create/New" button in the page header; contextual row actions in each record'
      : 'Primary action tied to the focal point (e.g. "Open"/"Continue")';

  const secondary: string[] = [];
  if (isCollection) secondary.push('Secondary "Filter" and "Export" actions in the toolbar');
  if (isEditorial) secondary.push('Secondary "Edit"/"Share"/"More" actions in the view header');
  if (isFormHeavy) secondary.push('Secondary "Cancel" that discards changes with confirmation when dirty');

  const hierarchy = [
    `Page title (display) → section headings (heading) → body (body)`,
    isCollection ? 'Dense scannable rows with clear primary text and muted metadata' : 'Content grouped in cards with a leading summary',
    'Interactive controls visually sit at interaction weight above static content',
    'Primary actions use the strongest color (primary); destructive actions use danger',
    'Visual prominence follows read-order: focal content first',
  ];

  const loading = isCollection
    ? 'Skeleton rows matching the collection shape (no layout jump) with a live "Loading…" status'
    : 'Skeleton header + content blocks; buttons show inline spinner while their action runs';

  const empty = isCollection
    ? `Empty state with illustration + descriptive title, an introduction to the feature, and the primary "${isCollection ? 'Create' : 'Add'}" call-to-action`
    : 'Empty state with contextual guidance and a clear next action';

  const error = isFormHeavy
    ? 'Inline field-level validation (danger border + message + aria-invalid) plus a summary alert'
    : 'Full-region error state with retry that preserves entered input';

  const responsiveStrategy =
    context.energy === 'high'
      ? 'Mobile-first single column; toolbar actions move into a sheet; grids collapse to 1 column below 720px'
      : 'Desktop grid → 2 panels at 1024px → 1 column at 720px; sticky header compresses to a compact bar';

  return {
    pageKey: doc.pageKey,
    visualHierarchy: hierarchy,
    focalPoint: isCollection
      ? 'The first active record / newly created item receives emphasis (highlight + scroll into view)'
      : isEditorial
        ? 'The subject detail (title + primary media) is the visual anchor'
        : 'The form/document body is the primary reading and editing region',
    primaryAction,
    secondaryActions: secondary,
    headerTreatment: `${doc.title} presented with a ${isCollection ? 'compact toolbar header' : 'sectional header'} + descriptive subtitle`,
    responsiveStrategy,
    loadingStrategy: loading,
    emptyState: empty,
    errorState: error,
  };
}

export function buildPageAssetPlan(
  doc: PageDesignDoc,
  context: ProjectDesignContext,
): { readonly icons: readonly string[]; readonly images: readonly { readonly slot: string; readonly style: string }[] } {
  const contentKind = classifyContent(doc.layout);
  const iconPool: string[] = [];

  const addIcon = (i: string) => { if (!iconPool.includes(i)) iconPool.push(i); };
  if (doc.layout.some((l) => l.contentType === 'form')) addIcon('plus');
  if (doc.layout.some((l) => l.contentType === 'list' || l.contentType === 'table')) {
    addIcon('filter');
    addIcon('search');
    addIcon('more');
  }
  if (doc.layout.some((l) => l.contentType === 'dashboard' || l.contentType === 'stats')) {
    addIcon('trending-up');
    addIcon('bar-chart');
  }
  if (doc.layout.some((l) => l.contentType === 'detail')) {
    addIcon('edit');
    addIcon('share');
    addIcon('chevron-left');
  }
  addIcon('chevron-right');
  addIcon('spinner');
  addIcon('alert-triangle');
  addIcon('check-circle');

  const images = context.surfaceScale === 'minimal'
    ? []
    : [
        { slot: 'page-illustration', style: `${context.domain}-flavored illustrated empty/hero graphic` },
        { slot: 'entity-thumb', style: `${context.domain}-flavored abstract thumbnail` },
      ];

  return { icons: iconPool, images };
}

export function buildPageComponentUsage(doc: PageDesignDoc): readonly string[] {
  const used = new Set<string>();
  const contentKind = classifyContent(doc.layout);

  // Shared chrome every functioning page needs.
  used.add('button');
  used.add('badge');

  if (contentKind === 'form' || contentKind === 'settings' || contentKind === 'profile') {
    used.add('input');
    used.add('checkbox');
    used.add('radio');
    used.add('select');
    used.add('switch');
  }
  if (contentKind === 'list' || contentKind === 'table') {
    used.add('table');
    used.add('filter');
    used.add('pagination');
  }
  if (contentKind === 'search') {
    used.add('search');
    used.add('filter');
    used.add('list');
  }
  if (contentKind === 'grid' || contentKind === 'dashboard') used.add('card');
  if (contentKind === 'detail') used.add('list');
  used.add('dialog');
  used.add('alert');
  used.add('breadcrumb');

  return [...used].sort();
}
