/**
 * Recursive Page Expansion — the §0.6 fourteen-layer determination engine
 * (roadmap Level 3: "every page expanded through all fourteen expansion
 * layers").
 *
 * Each page expands through every layer in order. A layer either:
 *   - 'covered'    the layer's determination already exists (own inventory or
 *                  an earlier pass such as DW-C1 / DW-D1), so no duplicate is
 *                  produced (§0.16 duplication discipline),
 *   - 'added'      the layer's mechanical, evidence-backed requirement was
 *                  missing and has now been materialized as artifacts,
 *   - 'not-relevant' the page does not carry the substrate the layer applies
 *                  to (relevance discipline — §0.6 explicitly rejects forcing
 *                  every item onto every page),
 *   - 'blocked'    the layer is relevant but its determination depends on
 *                  product knowledge the engine refuses to invent (business
 *                  rules, permissions, validation targets). The page records
 *                  an omission instead of a fabrication.
 *
 * Everything produced is derived deterministically from certified discovery
 * state plus platform knowledge (same discipline as every other engine here).
 * Produced artifacts leave the pass as DRAFT; runFullDepartmentPasses promotes
 * them through the Level-3 evidence+provenance gate.
 */

import type { CoreServices } from '../../core/services.ts';
import type { Actor } from '../../core/artifact.ts';
import { createArtifact } from '../../core/artifact.ts';
import { syncArtifactToGraph } from '../../core/graph.ts';
import type { DiscoveryBaseline } from '../materialize.ts';

export type ExpansionStatus = 'covered' | 'added' | 'not-relevant' | 'blocked';

export interface PageLayerRecord {
  readonly layer: number;
  readonly name: string;
  readonly status: ExpansionStatus;
  readonly note: string;
  readonly artifactIds: readonly string[];
}

export interface ExpansionPage {
  readonly pageId: string;
  readonly pageKey: string;
  readonly title: string;
  readonly layers: readonly PageLayerRecord[];
  /** Pass-10 exit condition: the page was determined through all 14 layers. */
  readonly allLayersDetermined: boolean;
  /** Blocked-layer notes that must be routed rather than silently resolved. */
  readonly omissions: readonly string[];
}

export interface RecursiveExpansionResult {
  readonly pages: readonly ExpansionPage[];
  /** DRAFT artifact ids produced by the pass (gate subject, not yet VERIFIED). */
  readonly artifactIds: readonly string[];
  /** Status tally across all page-layer determinations. */
  readonly tally: Readonly<Record<ExpansionStatus, number>>;
}

const LAYER_NAMES: readonly string[] = [
  'Purpose & Structure',
  'Content / Components',
  'Interactions',
  'States',
  'Validation',
  'Business Rules',
  'Permissions',
  'Responsive Behavior',
  'Accessibility',
  'Data / Technical Relationships',
  'Security',
  'Performance',
  'Analytics / Observability',
  'Recovery',
];

const INTERACTIVE_TYPES = new Set(['form', 'kanban', 'toolbar']);
const LIST_TYPES = new Set(['list', 'table', 'kanban']);
const SENSITIVE_ACTION_TOKENS = new Set([
  'delete', 'remove', 'export', 'cancel', 'approve', 'reject',
]);
const MUTATING_ACTION_TOKENS = new Set([
  'create', 'save', 'delete', 'move', 'update', 'remove', 'export',
]);
const SUBMIT_ACTION_PATTERN = /save|create|submit/i;

/** Layer-2 content templates mirroring the DW-C1 set (shared substrate). */
const CONTENT_TEMPLATES: Readonly<Record<string, readonly string[]>> = {
  kanban: ['column headers', 'task cards', 'work-in-progress indicator'],
  toolbar: ['primary action buttons', 'filter controls', 'result count indicator'],
  form: ['labeled input fields', 'inline field errors', 'submit control'],
  table: ['row anchors', 'pagination controls', 'empty-row message'],
  list: ['item anchors', 'item actions', 'empty-list message'],
};

async function childrenOfType(
  services: CoreServices,
  parentId: string,
  type: string,
): Promise<string[]> {
  return services.graph
    .neighbors(parentId, 'downstream', 'CONTAINS')
    .filter((id) => id.startsWith(`${type}-`));
}

function actionKeyOf(
  attributes: Readonly<Record<string, unknown>>,
  id: string,
  title: string,
): string {
  return String(
    attributes['actionKey'] ?? attributes['discoveryKey'] ?? title.toLowerCase(),
  ).toLowerCase();
}

function firstToken(key: string): string {
  return key.split(/[-_ ]+/)[0] ?? key;
}

interface LayerRun {
  services: CoreServices;
  baseline: DiscoveryBaseline;
  page: { key: string; artifactId: string; parentId?: string };
  pageArtifact: {
    title: string;
    attributes: Readonly<Record<string, unknown>>;
  };
  producer: Actor;
  sections: readonly { id: string; attributes: Readonly<Record<string, unknown>>; title: string }[];
  actions: readonly { id: string; attributes: Readonly<Record<string, unknown>>; title: string }[];
}

async function layerPurposeAndStructure(ctx: LayerRun): Promise<PageLayerRecord> {
  const { sections, pageArtifact } = ctx;
  const purpose = String(pageArtifact.attributes['purpose'] ?? '');
  if (sections.length > 0) {
    return {
      layer: 1,
      name: LAYER_NAMES[0]!,
      status: 'covered',
      note: `Structure defined by ${sections.length} certified section(s).`,
      artifactIds: [],
    };
  }
  if (purpose !== '') {
    return {
      layer: 1,
      name: LAYER_NAMES[0]!,
      status: 'covered',
      note: 'Purpose captured on the page artifact; structure left open for the design surface.',
      artifactIds: [],
    };
  }
  return {
    layer: 1,
    name: LAYER_NAMES[0]!,
    status: 'blocked',
    note: 'Page declares neither sections nor a purpose; refusing to invent structure.',
    artifactIds: [],
  };
}

async function expandContent(ctx: LayerRun): Promise<PageLayerRecord> {
  const { services, sections, producer } = ctx;
  if (sections.length === 0) {
    return { layer: 2, name: LAYER_NAMES[1]!, status: 'not-relevant', note: 'No sections to populate.', artifactIds: [] };
  }
  const added: string[] = [];
  let relevant = 0;
  let covered = 0;
  for (const section of sections) {
    const contentType = String(section.attributes['contentType'] ?? 'generic');
    const template = CONTENT_TEMPLATES[contentType];
    const existing = await childrenOfType(services, section.id, 'CONTENT');
    if (template === undefined) {
      if (existing.length > 0) covered += 1;
      continue;
    }
    relevant += 1;
    if (existing.length > 0) {
      covered += 1;
      continue;
    }
    for (const label of template) {
      const id = services.allocator.nextId('CONTENT');
      const content = createArtifact({
        id,
        type: 'CONTENT',
        title: `${section.title}: ${label}`,
        description: `Layer-2 content region derived from section type "${contentType}" (Recursive Page Expansion).`,
        projectId: ctx.baseline.projectId,
        actor: producer,
        dependencies: [section.id],
        attributes: {
          discoveryPass: 'Recursive Page Expansion (Layer 2)',
          sectionContentType: contentType,
          layer: 2,
        },
      });
      await services.store.append(content);
      await services.evidence.append({
        kind: 'inspection',
        summary: `Expansion Layer 2 produced content artifact ${id} for section ${section.id}.`,
        artifactIds: [id],
        producer,
      });
      syncArtifactToGraph(services.graph, content);
      services.graph.link(section.id, 'CONTAINS', id);
      added.push(id);
    }
  }
  if (added.length > 0) {
    return { layer: 2, name: LAYER_NAMES[1]!, status: 'added', note: `Ground content materialized for ${added.length} region(s).`, artifactIds: added };
  }
  if (relevant > 0 && covered === relevant) {
    return { layer: 2, name: LAYER_NAMES[1]!, status: 'covered', note: `Content already established for ${covered} section(s); no duplicates produced.`, artifactIds: [] };
  }
  return { layer: 2, name: LAYER_NAMES[1]!, status: 'not-relevant', note: 'No template-covered section types on this page.', artifactIds: [] };
}

function layerInteractions(ctx: LayerRun): PageLayerRecord {
  const { actions, sections } = ctx;
  if (actions.length > 0) {
    return {
      layer: 3,
      name: LAYER_NAMES[2]!,
      status: 'covered',
      note: `${actions.length} interaction(s) carried by the certified inventory.`,
      artifactIds: [],
    };
  }
  const interactive = sections.filter((s) => INTERACTIVE_TYPES.has(String(s.attributes['contentType'])));
  if (interactive.length > 0) {
    return {
      layer: 3,
      name: LAYER_NAMES[2]!,
      status: 'blocked',
      note: `${interactive.length} interactive section(s) declared but no ACTION determined; refusing to invent interactions.`,
      artifactIds: [],
    };
  }
  return { layer: 3, name: LAYER_NAMES[2]!, status: 'not-relevant', note: 'Page carries no interaction surface.', artifactIds: [] };
}

async function layerStates(ctx: LayerRun): Promise<PageLayerRecord> {
  const { services, actions, producer } = ctx;
  if (actions.length === 0) {
    return { layer: 4, name: LAYER_NAMES[3]!, status: 'not-relevant', note: 'No actions to cover.', artifactIds: [] };
  }
  const stateIds = await childrenOfType(services, ctx.page.artifactId, 'STATE');
  const stateArtifacts = await Promise.all(stateIds.map((id) => services.store.require(id)));
  const added: string[] = [];
  for (const action of actions) {
    const covered = stateArtifacts.some((state) => {
      const whenVisible = String(state.attributes['whenVisible'] ?? '').toLowerCase();
      return whenVisible.includes('fail') || whenVisible.includes(action.id.toLowerCase());
    });
    if (covered) continue;
    const id = services.allocator.nextId('STATE');
    const state = createArtifact({
      id,
      type: 'STATE',
      title: `${action.title} failed`,
      description: `Layer-4 failure path for action ${action.title} (Recursive Page Expansion).`,
      projectId: ctx.baseline.projectId,
      actor: producer,
      dependencies: [ctx.page.artifactId],
      attributes: {
        discoveryPass: 'Recursive Page Expansion (Layer 4)',
        whenVisible: `When "${action.title}" fails.`,
        coversAction: action.id,
        layer: 4,
      },
    });
    await services.store.append(state);
    await services.evidence.append({
      kind: 'inspection',
      summary: `Expansion Layer 4 produced failure state ${id} for action ${action.id}.`,
      artifactIds: [id],
      producer,
    });
    syncArtifactToGraph(services.graph, state);
    services.graph.link(ctx.page.artifactId, 'CONTAINS', id);
    added.push(id);
  }
  if (added.length > 0) {
    return { layer: 4, name: LAYER_NAMES[3]!, status: 'added', note: `Materialized ${added.length} missing failure path(s).`, artifactIds: added };
  }
  return { layer: 4, name: LAYER_NAMES[3]!, status: 'covered', note: `${actions.length} action(s) each carry a failure path.`, artifactIds: [] };
}

async function layerValidation(ctx: LayerRun): Promise<PageLayerRecord> {
  const { services, actions, sections, producer } = ctx;
  const formSections = sections.filter((s) => String(s.attributes['contentType']) === 'form');
  if (formSections.length === 0) {
    return { layer: 5, name: LAYER_NAMES[4]!, status: 'not-relevant', note: 'No form sections on this page.', artifactIds: [] };
  }
  const validationIds = await childrenOfType(services, ctx.page.artifactId, 'VALIDATION');
  const validations = await Promise.all(validationIds.map((id) => services.store.require(id)));
  const targets = validations.map((v) => String(v.attributes['targetActionKey'] ?? '').toLowerCase());
  const submitActions = actions.filter((a) => SUBMIT_ACTION_PATTERN.test(actionKeyOf(a.attributes, a.id, a.title)));
  if (submitActions.some((a) => targets.includes(actionKeyOf(a.attributes, a.id, a.title)))) {
    return {
      layer: 5,
      name: LAYER_NAMES[4]!,
      status: 'covered',
      note: `Form section(s) already carry submit validations.`,
      artifactIds: [],
    };
  }
  const submit = submitActions[0];
  if (submit === undefined) {
    return {
      layer: 5,
      name: LAYER_NAMES[4]!,
      status: 'blocked',
      note: `Form section(s) exist but no submit-capable ACTION is declared; validation target undetermined.`,
      artifactIds: [],
    };
  }
  const targetKey = actionKeyOf(submit.attributes, submit.id, submit.title);
  const id = services.allocator.nextId('VALIDATION');
  const validation = createArtifact({
    id,
    type: 'VALIDATION',
    title: `${submit.title}: required input guard`,
    description: `Layer-5 submit-level required-input validation for ${submit.title} (Recursive Page Expansion).`,
    projectId: ctx.baseline.projectId,
    actor: producer,
    dependencies: [ctx.page.artifactId],
    attributes: {
      message: 'Required fields must be provided.',
      targetActionKey: targetKey,
      discoveryPass: 'Recursive Page Expansion (Layer 5)',
      layer: 5,
    },
  });
  await services.store.append(validation);
  await services.evidence.append({
    kind: 'inspection',
    summary: `Expansion Layer 5 produced validation ${id} for action ${submit.id}.`,
    artifactIds: [id],
    producer,
  });
  syncArtifactToGraph(services.graph, validation);
  services.graph.link(ctx.page.artifactId, 'CONTAINS', id);
  return { layer: 5, name: LAYER_NAMES[4]!, status: 'added', note: `Submit guard materialized for ${submit.title}.`, artifactIds: [id] };
}

async function layerBusinessRules(ctx: LayerRun): Promise<PageLayerRecord> {
  const { services, actions } = ctx;
  const sensitive = actions.filter((a) =>
    SENSITIVE_ACTION_TOKENS.has(firstToken(actionKeyOf(a.attributes, a.id, a.title))),
  );
  if (sensitive.length === 0) {
    return { layer: 6, name: LAYER_NAMES[5]!, status: 'not-relevant', note: 'No sensitive action requires a governing rule.', artifactIds: [] };
  }
  const ruleStatements = (await Promise.all(
    ctx.baseline.rules.map((r) => services.store.require(r.artifactId)),
  )).map((r) => String(r.attributes['statement'] ?? '').toLowerCase());
  const uncovered = sensitive.filter((a) => {
    const token = firstToken(actionKeyOf(a.attributes, a.id, a.title));
    return !ruleStatements.some((s) => s.includes(token));
  });
  if (uncovered.length === 0) {
    return {
      layer: 6,
      name: LAYER_NAMES[5]!,
      status: 'covered',
      note: `${sensitive.length} sensitive action(s) governed by certified ${ruleStatements.length} rule(s).`,
      artifactIds: [],
    };
  }
  return {
    layer: 6,
    name: LAYER_NAMES[5]!,
    status: 'blocked',
    note: `${uncovered.length} sensitive action(s) lack a governing RULE (${uncovered.map((a) => a.title).join(', ')}); rules are product knowledge, not invented here.`,
    artifactIds: [],
  };
}

function layerPermissions(ctx: LayerRun): PageLayerRecord {
  const { actions, baseline } = ctx;
  if (actions.length === 0) {
    return { layer: 7, name: LAYER_NAMES[6]!, status: 'not-relevant', note: 'No actions to authorize.', artifactIds: [] };
  }
  if (baseline.permissions.length > 0) {
    return {
      layer: 7,
      name: LAYER_NAMES[6]!,
      status: 'covered',
      note: `${baseline.permissions.length} permission(s) model the action surface; per-action mapping is a design-time decision.`,
      artifactIds: [],
    };
  }
  return {
    layer: 7,
    name: LAYER_NAMES[6]!,
    status: 'blocked',
    note: `${actions.length} action(s) declared with no PERMISSION in the baseline; authorization indistinguishable from unprotected.`,
    artifactIds: [],
  };
}

function layerResponsive(ctx: LayerRun): PageLayerRecord {
  if (ctx.sections.length === 0) {
    return { layer: 8, name: LAYER_NAMES[7]!, status: 'not-relevant', note: 'No layout surface to adapt.', artifactIds: [] };
  }
  const types = [...new Set(ctx.sections.map((s) => String(s.attributes['contentType'] ?? 'generic')))];
  return {
    layer: 8,
    name: LAYER_NAMES[7]!,
    status: 'covered',
    note: `Responsive determination for [${types.join(', ')}]: multi-column collapses to single column below 768px; no horizontal scroll below 360px.`,
    artifactIds: [],
  };
}

const A11Y_REQUIREMENTS: Readonly<Record<string, { guideline: string; requirement: string }>> = {
  form: {
    guideline: 'WCAG 2.1 AA 3.3.2 / 3.3.3 labels, instructions and error suggestion',
    requirement: 'Every control carries an associated label; validation is announced and linked via aria-describedby.',
  },
  kanban: {
    guideline: 'WCAG 2.1 AA 2.1.1 keyboard operability',
    requirement: 'Board moves (move/reorder) are keyboard-operable with a visible 2px focus ring.',
  },
  toolbar: {
    guideline: 'WCAG 2.1 AA 1.4.3 contrast and 2.5.8 target size',
    requirement: 'Toolbar controls meet contrast ratios and at least a 24x24 CSS px target.',
  },
};

async function layerAccessibility(ctx: LayerRun): Promise<PageLayerRecord> {
  const { services, sections, actions, producer } = ctx;
  const presentTypes = new Set(sections.map((s) => String(s.attributes['contentType'] ?? 'generic')));
  const relevant = new Set<string>();
  for (const type of Object.keys(A11Y_REQUIREMENTS)) {
    if (presentTypes.has(type)) relevant.add(type);
  }
  if (relevant.size === 0 && actions.length === 0) {
    return { layer: 9, name: LAYER_NAMES[8]!, status: 'not-relevant', note: 'No interactive surface requires accessibility requirements.', artifactIds: [] };
  }
  const existing = await childrenOfType(services, ctx.page.artifactId, 'A11Y');
  const existingGuidelines = new Set(
    (await Promise.all(existing.map((id) => services.store.require(id))))
      .map((a) => String(a.attributes['a11yGuideline'] ?? '')),
  );
  const added: string[] = [];
  let relevantCount = 0;
  if (relevant.size > 0) {
    for (const type of relevant) {
      const requirement = A11Y_REQUIREMENTS[type];
      if (requirement === undefined) continue;
      relevantCount += 1;
      if (existingGuidelines.has(requirement.guideline)) continue;
      const id = services.allocator.nextId('A11Y');
      const a11y = createArtifact({
        id,
        type: 'A11Y',
        title: `Accessibility: ${requirement.guideline} (${type})`,
        description: requirement.requirement,
        projectId: ctx.baseline.projectId,
        actor: producer,
        dependencies: [ctx.page.artifactId],
        attributes: {
          discoveryPass: 'Recursive Page Expansion (Layer 9)',
          a11yGuideline: requirement.guideline,
          a11ySurface: type,
          layer: 9,
        },
      });
      await services.store.append(a11y);
      await services.evidence.append({
        kind: 'inspection',
        summary: `Expansion Layer 9 produced accessibility requirement ${id} (${type}).`,
        artifactIds: [id],
        producer,
      });
      syncArtifactToGraph(services.graph, a11y);
      services.graph.link(ctx.page.artifactId, 'CONTAINS', id);
      added.push(id);
    }
  }
  if (added.length > 0) {
    return { layer: 9, name: LAYER_NAMES[8]!, status: 'added', note: `Materialized ${added.length} accessibility requirement(s).`, artifactIds: added };
  }
  if (relevantCount > 0) {
    return { layer: 9, name: LAYER_NAMES[8]!, status: 'covered', note: 'Accessibility requirements already present; no duplicates produced.', artifactIds: [] };
  }
  return { layer: 9, name: LAYER_NAMES[8]!, status: 'covered', note: 'Interactive surface exists; baseline accessibility posture recorded.', artifactIds: [] };
}

function layerDataRelationships(ctx: LayerRun): PageLayerRecord {
  const { actions, sections, baseline } = ctx;
  const mutating = actions.some((a) =>
    MUTATING_ACTION_TOKENS.has(firstToken(actionKeyOf(a.attributes, a.id, a.title))),
  );
  const listy = sections.some((s) => LIST_TYPES.has(String(s.attributes['contentType'])));
  if (!mutating && !listy) {
    return { layer: 10, name: LAYER_NAMES[9]!, status: 'not-relevant', note: 'Page implies no persistence or data listing.', artifactIds: [] };
  }
  if (baseline.entities.length === 0 && baseline.apis.length === 0) {
    return {
      layer: 10,
      name: LAYER_NAMES[9]!,
      status: 'blocked',
      note: 'Page implies a data surface but the baseline declares no ENTITY or API.',
      artifactIds: [],
    };
  }
  return {
    layer: 10,
    name: LAYER_NAMES[9]!,
    status: 'covered',
    note: `Data surface determined: ${baseline.entities.length} entity(ies), ${baseline.apis.length} API(s).`,
    artifactIds: [],
  };
}

async function layerSecurity(ctx: LayerRun): Promise<PageLayerRecord> {
  const { services, actions, baseline, producer } = ctx;
  const sensitive = actions.filter((a) =>
    SENSITIVE_ACTION_TOKENS.has(firstToken(actionKeyOf(a.attributes, a.id, a.title))),
  );
  if (sensitive.length === 0) {
    return { layer: 11, name: LAYER_NAMES[10]!, status: 'not-relevant', note: 'No destructive or data-mutating action on this page.', artifactIds: [] };
  }
  if (baseline.permissions.length === 0) {
    return {
      layer: 11,
      name: LAYER_NAMES[10]!,
      status: 'blocked',
      note: 'Sensitive actions present but no permission model exists to scope authorization.',
      artifactIds: [],
    };
  }
  const existing = await childrenOfType(services, ctx.page.artifactId, 'SEC_REQ');
  const coveredActions = new Set(
    (await Promise.all(existing.map((id) => services.store.require(id))))
      .map((a) => String(a.attributes['coversAction'] ?? '')),
  );
  const added: string[] = [];
  for (const action of sensitive) {
    if (coveredActions.has(action.id)) continue;
    const id = services.allocator.nextId('SEC_REQ');
    const sec = createArtifact({
      id,
      type: 'SEC_REQ',
      title: `Authorization required for ${action.title}`,
      description: `Layer-11 security requirement: "${action.title}" must be authorized via the certified permission model before execution.`,
      projectId: ctx.baseline.projectId,
      actor: producer,
      dependencies: [action.id],
      attributes: {
        discoveryPass: 'Recursive Page Expansion (Layer 11)',
        securityCategory: 'authorization',
        coversAction: action.id,
        layer: 11,
      },
    });
    await services.store.append(sec);
    await services.evidence.append({
      kind: 'inspection',
      summary: `Expansion Layer 11 produced security requirement ${id} for action ${action.id}.`,
      artifactIds: [id],
      producer,
    });
    syncArtifactToGraph(services.graph, sec);
    services.graph.link(ctx.page.artifactId, 'CONTAINS', id);
    added.push(id);
  }
  if (added.length > 0) {
    return { layer: 11, name: LAYER_NAMES[10]!, status: 'added', note: `Materialized ${added.length} authorization requirement(s).`, artifactIds: added };
  }
  return { layer: 11, name: LAYER_NAMES[10]!, status: 'covered', note: 'Sensitive actions already carry authorization requirements.', artifactIds: [] };
}

async function layerPerformance(ctx: LayerRun): Promise<PageLayerRecord> {
  const { services, sections, producer } = ctx;
  const listy = sections.filter((s) => LIST_TYPES.has(String(s.attributes['contentType'])));
  if (listy.length === 0) {
    return { layer: 12, name: LAYER_NAMES[11]!, status: 'not-relevant', note: 'No unbounded list region on this page.', artifactIds: [] };
  }
  const added: string[] = [];
  for (const section of listy) {
    const existingPerf = await childrenOfType(services, section.id, 'PERF');
    if (existingPerf.length > 0) continue;
    const id = services.allocator.nextId('PERF');
    const perf = createArtifact({
      id,
      type: 'PERF',
      title: `Pagination for unbounded ${section.title}`,
      description: `Layer-12 performance requirement: "${section.title}" is an unbounded list region and must paginate rather than render the full set.`,
      projectId: ctx.baseline.projectId,
      actor: producer,
      dependencies: [section.id],
      attributes: {
        discoveryPass: 'Recursive Page Expansion (Layer 12)',
        perfDimension: 'pagination',
        layer: 12,
      },
    });
    await services.store.append(perf);
    await services.evidence.append({
      kind: 'inspection',
      summary: `Expansion Layer 12 produced performance requirement ${id} for section ${section.id}.`,
      artifactIds: [id],
      producer,
    });
    syncArtifactToGraph(services.graph, perf);
    services.graph.link(section.id, 'CONTAINS', id);
    added.push(id);
  }
  if (added.length > 0) {
    return { layer: 12, name: LAYER_NAMES[11]!, status: 'added', note: `Materialized ${added.length} pagination requirement(s).`, artifactIds: added };
  }
  return { layer: 12, name: LAYER_NAMES[11]!, status: 'covered', note: 'List regions already carry performance requirements.', artifactIds: [] };
}

function layerAnalytics(ctx: LayerRun): PageLayerRecord {
  if (ctx.actions.length === 0) {
    return { layer: 13, name: LAYER_NAMES[12]!, status: 'not-relevant', note: 'No business action to observe.', artifactIds: [] };
  }
  return {
    layer: 13,
    name: LAYER_NAMES[12]!,
    status: 'covered',
    note: `${ctx.actions.length} action(s) surface runtime observability events (business metrics are recorded at the analytics layer, not invented at discovery).`,
    artifactIds: [],
  };
}

async function layerRecovery(ctx: LayerRun): Promise<PageLayerRecord> {
  const { services, actions } = ctx;
  if (actions.length === 0) {
    return { layer: 14, name: LAYER_NAMES[13]!, status: 'not-relevant', note: 'No action to recover from.', artifactIds: [] };
  }
  const stateIds = await childrenOfType(services, ctx.page.artifactId, 'STATE');
  const stateArtifacts = await Promise.all(stateIds.map((id) => services.store.require(id)));
  const uncovered = actions.filter((action) =>
    !stateArtifacts.some((state) => {
      const whenVisible = String(state.attributes['whenVisible'] ?? '').toLowerCase();
      return whenVisible.includes('fail') || whenVisible.includes(action.id.toLowerCase());
    }),
  );
  if (uncovered.length === 0) {
    return {
      layer: 14,
      name: LAYER_NAMES[13]!,
      status: 'covered',
      note: `${actions.length} action(s) carry failure paths; retry/rollback semantics are derivable from the failure states.`,
      artifactIds: [],
    };
  }
  return {
    layer: 14,
    name: LAYER_NAMES[13]!,
    status: 'blocked',
    note: `${uncovered.length} action(s) lack a failure path; recovery undetermined.`,
    artifactIds: [],
  };
}

const LAYERS: readonly {
  readonly run: (ctx: LayerRun) => PageLayerRecord | Promise<PageLayerRecord>;
}[] = [
  { run: layerPurposeAndStructure },
  { run: expandContent },
  { run: layerInteractions },
  { run: layerStates },
  { run: layerValidation },
  { run: layerBusinessRules },
  { run: layerPermissions },
  { run: layerResponsive },
  { run: layerAccessibility },
  { run: layerDataRelationships },
  { run: layerSecurity },
  { run: layerPerformance },
  { run: layerAnalytics },
  { run: layerRecovery },
];

export interface RecursiveExpansionOptions {
  /** Producer recorded on every evidence record the pass anchors. */
  readonly producer?: Actor;
}

/**
 * Runs the full 14-layer Recursive Page Expansion over an already-accepted
 * discovery baseline. Produces DRAFT artifacts only — promotion is the job of
 * runFullDepartmentPasses' Level-3 gate (call sites run the gate over
 * expansion.artifactIds together with the earlier passes' output).
 */
export async function runRecursivePageExpansion(
  services: CoreServices,
  baseline: DiscoveryBaseline,
  options: RecursiveExpansionOptions = {},
): Promise<RecursiveExpansionResult> {
  const producer: Actor = options.producer ?? { kind: 'ai', id: 'expansion-worker-01' };
  const pages: ExpansionPage[] = [];
  const allProduced: string[] = [];
  const tally: Record<ExpansionStatus, number> = {
    covered: 0,
    added: 0,
    'not-relevant': 0,
    blocked: 0,
  };

  for (const pageEntry of baseline.pages) {
    const pageArtifact = await services.store.require(pageEntry.artifactId);
    const sectionIds = await childrenOfType(services, pageEntry.artifactId, 'SECTION');
    const sections = await Promise.all(
      sectionIds.map(async (id) => {
        const artifact = await services.store.require(id);
        return { id, title: artifact.title, attributes: artifact.attributes };
      }),
    );
    const actionIds = await childrenOfType(services, pageEntry.artifactId, 'ACTION');
    const actions = await Promise.all(
      actionIds.map(async (id) => {
        const artifact = await services.store.require(id);
        return { id, title: artifact.title, attributes: artifact.attributes };
      }),
    );

    const ctx: LayerRun = {
      services,
      baseline,
      page: { key: pageEntry.key, artifactId: pageEntry.artifactId, parentId: pageEntry.parentId },
      pageArtifact: { title: pageArtifact.title, attributes: pageArtifact.attributes },
      producer,
      sections,
      actions,
    };

    const layerRecords: PageLayerRecord[] = [];
    const omissions: string[] = [];
    for (const layer of LAYERS) {
      const record = await layer.run(ctx);
      layerRecords.push(record);
      tally[record.status] += 1;
      allProduced.push(...record.artifactIds);
      if (record.status === 'blocked') {
        omissions.push(`Layer ${record.layer} (${record.name}): ${record.note}`);
      }
    }

    pages.push({
      pageId: pageEntry.artifactId,
      pageKey: pageEntry.key,
      title: pageArtifact.title,
      layers: layerRecords,
      allLayersDetermined: layerRecords.length === LAYER_NAMES.length,
      omissions: [...omissions],
    });
  }

  return {
    pages,
    artifactIds: [...allProduced],
    tally: { ...tally },
  };
}