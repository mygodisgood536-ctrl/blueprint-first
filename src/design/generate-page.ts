/** Per-page deterministic design derivation. */

import type { CoreServices } from '../core/services.ts';
import type { PageDesignDoc, SecurityNote } from './types.ts';
import type { DiscoveryBaseline } from '../discovery/materialize.ts';

const LAYOUT_HINTS = {
  kanban: 'Multi-column board; drag-and-drop between columns.',
  toolbar: 'Horizontal action bar pinned above content.',
  form: 'Single-column form with inline validation messages.',
} as Record<string, string>;

function layoutHintFor(contentType: string): string {
  return LAYOUT_HINTS[contentType] ?? `Standard container for "${contentType}" content.`;
}

export async function generatePageDesign(
  services: CoreServices,
  baseline: DiscoveryBaseline,
  pageEntry: { key: string; artifactId: string; parentId?: string },
): Promise<PageDesignDoc> {
  const pageArtifact = await services.store.require(pageEntry.artifactId);
  const children = (type: 'SECTION' | 'ACTION' | 'STATE' | 'VALIDATION') =>
    services.graph.neighbors(pageEntry.artifactId, 'downstream', 'CONTAINS')
      .filter((id) => id.startsWith(`${type}-`));

  const sections = await Promise.all(children('SECTION').map((id) => services.store.require(id)));
  const actions = await Promise.all(children('ACTION').map((id) => services.store.require(id)));
  const states = await Promise.all(children('STATE').map((id) => services.store.require(id)));
  const validations = await Promise.all(children('VALIDATION').map((id) => services.store.require(id)));
  const permissions = await Promise.all(
    baseline.permissions.map((p) => services.store.require(p.artifactId)),
  );

  const interactions = actions.map((action) => ({
    actionArtifactId: action.id,
    actionKey: String(action.attributes['actionKey'] ?? action.id),
    title: action.title,
    outcome: String(action.attributes['outcome'] ?? ''),
    validationMessages: validations
      .filter((v) => v.attributes['targetActionKey'] === action.attributes['actionKey'])
      .map((v) => String(v.attributes['message'] ?? '')),
  }));

  const securityNotes: SecurityNote[] = permissions.map((perm) => ({
    permissionKey: String(perm.attributes['discoveryKey']),
    resource: String(perm.attributes['resource']),
    roles: perm.attributes['roles'] as readonly string[],
    appliesHere: pageEntry.key.includes(String(perm.attributes['resource'])),
  }));
  if (interactions.some((i) => /delete/i.test(i.actionKey))) {
    securityNotes.push({
      permissionKey: 'destructive-action-guard',
      resource: 'destructive actions',
      roles: ['admin'],
      appliesHere: true,
    });
  }

  return {
    pageArtifactId: pageEntry.artifactId,
    pageKey: pageEntry.key,
    title: pageArtifact.title,
    purpose: String(pageArtifact.attributes['purpose'] ?? pageArtifact.description),
    moduleId: pageEntry.parentId ?? '',
    navigation: { inMainNav: true, route: `/${pageEntry.key}`, label: pageArtifact.title },
    layout: sections
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .map((s) => ({
        sectionKey: String(s.attributes['discoveryKey']),
        title: s.title,
        contentType: String(s.attributes['contentType'] ?? 'generic'),
        layoutHint: layoutHintFor(String(s.attributes['contentType'] ?? 'generic')),
      })),
    interactions,
    stateHandling: states
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .map((st) => ({
        stateArtifactId: st.id,
        name: st.title,
        whenVisible: String(st.attributes['whenVisible'] ?? ''),
      })),
    functionalRequirements: [
      ...interactions.map((i) =>
        `When "${i.title}" is triggered: ${i.outcome}${i.validationMessages.length > 0 ? ` Validations: ${i.validationMessages.join(' / ')}` : ''}`,
      ),
    ],
    nonFunctionalRequirements: [
      'Responsive down to a 360px viewport.',
      'All interactive elements keyboard-reachable with visible focus.',
    ],
    dataNotes:
      baseline.entities.length > 0
        ? `Product entities: ${baseline.entities.map((e) => e.key).join(', ')}.`
        : 'No entities discovered.',
    apiNotes:
      baseline.apis.length > 0
        ? `API surface: ${baseline.apis.map((a) => `${a.key}`).join(', ')}.`
        : 'No APIs discovered.',
    securityNotes,
    constraints: 'Preserve workflow ordering from certified discovery workflows.',
  };
}
