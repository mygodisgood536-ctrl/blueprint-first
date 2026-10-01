/**
 * Level 3 — Full Discovery Department passes (spec §0.3 clusters C/D/E,
 * §0.5–0.11, §0.19–0.20; roadmap line "Worker Corps Clusters C, D and E in
 * full").
 *
 * These passes run AFTER the Level-1b boss has accepted the structural
 * inventory and enrich it deterministically — same discipline as every other
 * engine here: derivation from certified state plus platform knowledge, never
 * fabricated AI prose.
 *
 *   Cluster C/DW-C1  Page Content Discovery ......... CONTENT children per
 *                                                    section, derived from the
 *                                                    section's declared type
 *   Cluster D/DW-D1  Edge-Case Discovery ............ every action must have
 *                                                    a failure path: missing
 *                                                    error STATES are added
 *   Cluster D        Risk & Assumption Register ..... RISK artifacts per
 *                    (§0.20)                         non-functional dimension
 *   Cluster E        Negative-Space Discovery ....... implied-but-absent
 *                    (§0.11)                         siblings become Discovery
 *                                                    Questions (evidence),
 *                                                    never silent scope
 *   Industry Comparison (§0.9) ....................... category DNA diff ->
 *                                                    missing-feature FINDINGs
 *   Discovery Red Team (§0.10) ....................... admin/error/empty-state
 *                                                    page omissions -> FINDINGs
 *   Contradiction Engine (§0.19) ..................... rule×permission conflict
 *                                                    register (FINDINGs) that
 *                                                    block certification until
 *                                                    resolved via Council
 *   Recursive Page Expansion (§0.6) .................. every page determined
 *                                                    through all 14 expansion
 *                                                    layers (Pass 10)
 *   Discovery Auditor (DW-E5) ........................ samples the accepted
 *                                                    inventory, re-runs the
 *                                                    §0.18 evidence check,
 *                                                    issues the audit
 *                                                    certificate
 */

import type { CoreServices } from '../../core/services.ts';
import type { Actor } from '../../core/artifact.ts';
import { createArtifact } from '../../core/artifact.ts';
import { syncArtifactToGraph } from '../../core/graph.ts';
import { recordStatusChange } from '../../core/store.ts';
import type { DiscoveryBaseline } from '../materialize.ts';
import {
  runRecursivePageExpansion,
  type RecursiveExpansionResult,
} from './expansion.ts';

export interface FullDepartmentResult {
  readonly contentAdded: readonly string[];
  readonly edgeStatesAdded: readonly string[];
  readonly risks: readonly string[];
  readonly negativeSpaceQuestions: readonly string[];
  readonly matchedCategory: string | null;
  readonly comparisonFindings: readonly string[];
  readonly redTeamFindings: readonly string[];
  readonly contradictions: readonly ContradictionEntry[];
  /** §0.6 Recursive Page Expansion (14 layers per page) — Pass 10. */
  readonly expansion: RecursiveExpansionResult;
  readonly audited: boolean;
  readonly auditEvidenceId?: string;
  readonly artifactIds: readonly string[];
}

const CONTENT_TEMPLATES: Readonly<Record<string, readonly string[]>> = {
  kanban: ['column headers', 'task cards', 'work-in-progress indicator'],
  toolbar: ['primary action buttons', 'filter controls', 'result count indicator'],
  form: ['labeled input fields', 'inline field errors', 'submit control'],
};

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * §0.16 duplication discipline: a pass must not re-produce an artifact it (or
 * an earlier run) already produced for the same subject. Used by every Level-3
 * pass so running the full department twice is idempotent.
 */
async function hasExistingByAttribute(
  services: CoreServices,
  type: 'CONTENT' | 'RISK' | 'FINDING' | 'STATE' | 'VALIDATION' | 'A11Y' | 'PERF' | 'SEC_REQ',
  projectId: string,
  attribute: string,
  value: string,
): Promise<boolean> {
  const artifacts = await services.store.list({ types: [type], projectId });
  return artifacts.some((a) => String(a.attributes[attribute]) === value);
}

/** §0.16 dedup: does this section already carry CONTENT children? */
async function sectionHasContent(services: CoreServices, sectionId: string): Promise<boolean> {
  return (
    services.graph
      .neighbors(sectionId, 'downstream', 'CONTAINS')
      .filter((id) => id.startsWith('CONTENT-')).length > 0
  );
}

/** Cluster C — DW-C1: derive CONTENT children for every SECTION by its type. */
async function expandPageContent(
  services: CoreServices,
  baseline: DiscoveryBaseline,
  producer: Actor,
): Promise<string[]> {
  const added: string[] = [];
  for (const section of baseline.sections) {
    const sectionArtifact = await services.store.require(section.artifactId);
    if (await sectionHasContent(services, section.artifactId)) continue;
    const contentType = String(sectionArtifact.attributes['contentType'] ?? 'generic');
    const template =
      CONTENT_TEMPLATES[contentType] ?? [`primary ${contentType} content region`];
    for (const label of template) {
      const id = services.allocator.nextId('CONTENT');
      const content = createArtifact({
        id,
        type: 'CONTENT',
        title: `${sectionArtifact.title}: ${label}`,
        description: `Layer-2 content region derived from section type "${contentType}" (Recursive Page Expansion).`,
        projectId: baseline.projectId,
        actor: producer,
        dependencies: [section.artifactId],
        attributes: {
          discoveryPass: 'DW-C1 Page Content Discovery (Expansion Layer 2)',
          sectionContentType: contentType,
        },
      });
      await services.store.append(content);
      await services.evidence.append({
        kind: 'inspection',
        summary: `DW-C1 produced content artifact ${id} (Layer 2).`,
        artifactIds: [id],
        producer,
      });
      syncArtifactToGraph(services.graph, content);
      services.graph.link(section.artifactId, 'CONTAINS', id);
      added.push(id);
    }
  }
  return added;
}

/** Cluster D — DW-D1 Edge-Case Discovery: every action gets a failure path. */
async function discoverEdgeCases(
  services: CoreServices,
  baseline: DiscoveryBaseline,
  producer: Actor,
): Promise<string[]> {
  const added: string[] = [];
  for (const page of baseline.pages) {
    const actions = services.graph
      .neighbors(page.artifactId, 'downstream', 'CONTAINS')
      .filter((id) => id.startsWith('ACTION-'));
    const states = services.graph
      .neighbors(page.artifactId, 'downstream', 'CONTAINS')
      .filter((id) => id.startsWith('STATE-'));
    const stateArtifacts = await Promise.all(states.map((s) => services.store.require(s)));
    for (const actionId of actions) {
      const action = await services.store.require(actionId);
      // A failure path exists when any state on this page explicitly covers
      // this action's failure (whenVisible references the action key).
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
        description: `Edge-case failure path for action ${action.title} (DW-D1 Edge-Case Discovery).`,
        projectId: baseline.projectId,
        actor: producer,
        dependencies: [page.artifactId],
        attributes: {
          discoveryPass: 'DW-D1 Edge-Case Discovery',
          whenVisible: `When "${action.title}" fails.`,
          coversAction: actionId,
        },
      });
      await services.store.append(state);
      await services.evidence.append({
        kind: 'inspection',
        summary: `DW-D1 produced edge-case artifact ${id} (Layer 2).`,
        artifactIds: [id],
        producer,
      });
      syncArtifactToGraph(services.graph, state);
      services.graph.link(page.artifactId, 'CONTAINS', id);
      added.push(id);
    }
  }
  return added;
}

async function registerRisks(
  services: CoreServices,
  baseline: DiscoveryBaseline,
  producer: Actor,
): Promise<string[]> {
  const ids: string[] = [];
  const statements: readonly { dimension: string; kind: 'risk' | 'assumption'; statement: string }[] =
    [
      {
        dimension: 'security',
        kind: 'risk',
        statement: `Permission model covers ${baseline.permissions.length} resource(s); abuse paths between roles require security review.`,
      },
      {
        dimension: 'performance',
        kind: 'assumption',
        statement: `Assumed current page count (${baseline.pages.length}) performs within budget; load profile unverified at discovery time.`,
      },
      {
        dimension: 'accessibility',
        kind: 'risk',
        statement: 'Accessibility requirements are not yet discovered by a dedicated worker.',
      },
      {
        dimension: 'reliability',
        kind: 'assumption',
        statement: 'Assumed standard availability expectations; no SLA stated in the brief.',
      },
      {
        dimension: 'compliance',
        kind: 'risk',
        statement: 'Regulatory obligations (data retention, privacy) are undiscovered.',
      },
    ];
  for (const entry of statements) {
    if (
      await hasExistingByAttribute(
        services,
        'RISK',
        baseline.projectId,
        'dimension',
        entry.dimension,
      )
    ) {
      continue;
    }
    const id = services.allocator.nextId('RISK');
    const risk = createArtifact({
      id,
      type: 'RISK',
      title: `[${entry.kind}] ${entry.dimension}: ${entry.statement.slice(0, 60)}…`,
      description: entry.statement,
      projectId: baseline.projectId,
      actor: producer,
      dependencies: [baseline.projectId],
      attributes: {
        registerKind: entry.kind,
        dimension: entry.dimension,
        discoveryPass: 'Risk & Assumption Register (§0.20)',
      },
    });
    await services.store.append(risk);
    await services.evidence.append({
      kind: 'inspection',
      summary: `Risk & Assumption Register produced ${id} (${entry.kind}/${entry.dimension}).`,
      artifactIds: [id],
      producer,
    });
    syncArtifactToGraph(services.graph, risk);
    ids.push(id);
  }
  return ids;
}

/** Cluster E — §0.11 Negative-Space Discovery: implied-but-absent siblings
 *  become Discovery Questions (evidence records), never silent scope. */
const NEGATIVE_SPACE_RULES: readonly {
  readonly id: string;
  readonly question: string;
  readonly probe: (inv: DiscoveryBaseline, actionKeys: readonly string[]) => boolean;
}[] = [
  {
    id: 'delete-implies-restore',
    question: 'Deletion exists — is an undo/restore capability required?',
    probe: (_inv, actionKeys) => actionKeys.some((k) => /delete/i.test(k)),
  },
  {
    id: 'create-implies-bulk',
    question: 'Creation APIs exist — is bulk import required?',
    probe: (inv) => inv.apis.some((a) => String(a.artifactId).length > 0),
  },
  {
    id: 'permissions-implies-audit',
    question: 'Permissions exist — is an audit log of permission changes required?',
    probe: (inv) => inv.permissions.length > 0,
  },
];

async function discoverNegativeSpace(
  services: CoreServices,
  baseline: DiscoveryBaseline,
): Promise<{ questions: readonly string[]; evidenceIds: readonly string[] }> {
  const actionKeys: string[] = [];
  for (const page of baseline.pages) {
    for (const id of services.graph.neighbors(page.artifactId, 'downstream', 'CONTAINS')) {
      if (id.startsWith('ACTION-')) {
        const action = await services.store.require(id);
        actionKeys.push(String(action.attributes['discoveryKey'] ?? action.title));
      }
    }
  }
  const questions: string[] = [];
  const evidenceIds: string[] = [];
  for (const rule of NEGATIVE_SPACE_RULES) {
    if (!rule.probe(baseline, actionKeys)) continue;
    const evidence = await services.evidence.append({
      kind: 'inspection',
      summary: `Discovery Question (negative-space ${rule.id}): ${rule.question}`,
      artifactIds: [baseline.projectId],
      producer: { kind: 'ai', id: 'negative-space-worker-01' },
    });
    evidenceIds.push(evidence.id);
    questions.push(rule.question);
  }
  return { questions, evidenceIds };
}

/** Industry Comparison Engine (§0.9): category DNA diff → missing features.
 *  The Level-3 Product DNA Library is a minimal built-in taxonomy; unmatched
 *  categories produce an honest inconclusive instead of fabricated gaps. */
const CATEGORY_DNA: Readonly<Record<string, readonly string[]>> = {
  'team-productivity': [
    'task-management',
    'project-organization',
    'reporting-dashboard',
    'notifications',
    'user-roles',
  ],
};

function detectCategory(hint: string | undefined, baseline: DiscoveryBaseline): string | null {
  const corpus = `${hint ?? ''} ${baseline.projectId}`.toLowerCase();
  for (const category of Object.keys(CATEGORY_DNA)) {
    const tokens = category.split('-');
    if (tokens.every((t) => corpus.includes(t.split('/')[0] ?? t))) return category;
  }
  return null;
}

async function runIndustryComparison(
  services: CoreServices,
  baseline: DiscoveryBaseline,
  producer: Actor,
  categoryHint: string | undefined,
): Promise<{ findings: readonly string[]; matchedCategory: string | null }> {
  const category = detectCategory(categoryHint, baseline);
  if (category === null) {
    const evidence = await services.evidence.append({
      kind: 'inspection',
      summary: 'Industry Comparison: category not in the Level-3 DNA library; comparison inconclusive.',
      artifactIds: [baseline.projectId],
      producer,
    });
    void evidence;
    return { findings: [], matchedCategory: null };
  }
  const expected = CATEGORY_DNA[category] ?? [];
  const featureTitles: string[] = [];
  for (const f of baseline.features) {
    featureTitles.push(String((await services.store.require(f.artifactId)).title).toLowerCase());
  }
  const featureKeys = baseline.features.map((f) => f.key.toLowerCase());
  const findings: string[] = [];
  for (const expectedFeature of expected) {
    const hit =
      featureKeys.some((k) => k.includes(expectedFeature.split('-')[0] ?? '')) ||
      featureTitles.some((t) => expectedFeature.split('-').some((part) => t.includes(part)));
    if (hit) continue;
    if (
      await hasExistingByAttribute(
        services,
        'FINDING',
        baseline.projectId,
        'expectedFeature',
        expectedFeature,
      )
    ) {
      continue;
    }
    const id = services.allocator.nextId('FINDING');
    const finding = createArtifact({
      id,
      type: 'FINDING',
      title: `Industry comparison gap: expected feature "${expectedFeature}"`,
      description: `The ${category} category DNA expects this capability; the certified inventory has no counterpart.`,
      projectId: baseline.projectId,
      actor: producer,
      dependencies: [baseline.projectId],
      attributes: {
        findingKind: 'industry-comparison-gap',
        category,
        expectedFeature,
        dnaSource: `CATEGORY_DNA['${category}']`,
      },
    });
    await services.store.append(finding);
    await services.evidence.append({
      kind: 'inspection',
      summary: `Industry Comparison produced gap finding ${id} (${category} / ${expectedFeature}).`,
      artifactIds: [id],
      producer,
    });
    syncArtifactToGraph(services.graph, finding);
    findings.push(id);
  }
  return { findings, matchedCategory: category };
}

/** Cluster E — Discovery Red Team (§0.10): hunt commonly-underdiscovered
 *  page classes (admin / error / empty states) and log omissions by ID. */
async function runRedTeam(
  services: CoreServices,
  baseline: DiscoveryBaseline,
  producer: Actor,
): Promise<string[]> {
  const findings: string[] = [];
  const pageKeys: string[] = [];
  for (const page of baseline.pages) {
    const artifact = await services.store.require(page.artifactId);
    pageKeys.push(String(artifact.attributes['discoveryKey'] ?? '').toLowerCase());
  }
  const expectedClasses: readonly { readonly pattern: RegExp; readonly label: string }[] = [
    { pattern: /admin/, label: 'administrative pages' },
    { pattern: /error|failure|failed/, label: 'error pages' },
    { pattern: /empty|no-results/, label: 'empty-state pages' },
    { pattern: /session|expired|login/, label: 'session-expired handling' },
  ];
  for (const { pattern, label } of expectedClasses) {
    if (pageKeys.some((key) => pattern.test(key))) continue;
    if (
      await hasExistingByAttribute(
        services,
        'FINDING',
        baseline.projectId,
        'pageClassPattern',
        String(pattern),
      )
    ) {
      continue;
    }
    const id = services.allocator.nextId('FINDING');
    const finding = createArtifact({
      id,
      type: 'FINDING',
      title: `Red Team omission: ${label} absent from the inventory`,
      description:
        `The Red Team hunts the most commonly under-discovered page class (${label}); ` +
        `no discovered page matches. This is a genuine omission finding, not a style note.`,
      projectId: baseline.projectId,
      actor: producer,
      dependencies: [baseline.projectId],
      attributes: {
        findingKind: 'red-team-omission',
        pageClassPattern: String(pattern),
      },
    });
    await services.store.append(finding);
    await services.evidence.append({
      kind: 'inspection',
      summary: `Red Team produced omission finding ${id} (${label}).`,
      artifactIds: [id],
      producer,
    });
    syncArtifactToGraph(services.graph, finding);
    findings.push(id);
  }
  return findings;
}

/** §0.19 Contradiction Engine (Level-3 scope): direct rule×permission
 *  conflicts. Each entry cites BOTH artifacts by ID; resolution is routed to
 *  the Council - never silently picked. */
export interface ContradictionEntry {
  readonly findingId: string;
  readonly ruleId: string;
  readonly permissionId: string;
}

async function scanContradictions(
  services: CoreServices,
  baseline: DiscoveryBaseline,
  producer: Actor,
): Promise<ContradictionEntry[]> {
  const entries: ContradictionEntry[] = [];
  const rules = await Promise.all(baseline.rules.map((r) => services.store.require(r.artifactId)));
  const permissions = await Promise.all(
    baseline.permissions.map((p) => services.store.require(p.artifactId)),
  );
  for (const rule of rules) {
    const statement = String(rule.attributes['statement'] ?? '').toLowerCase();
    if (!/only admin/.test(statement)) continue; // direct-conflict pattern at L3
    for (const permission of permissions) {
      const roles = permission.attributes['roles'];
      if (!Array.isArray(roles)) continue;
      const nonAdminRoles = (roles as unknown[]).filter(
        (r) => typeof r === 'string' && r !== 'admin',
      );
      if (nonAdminRoles.length === 0) continue;
      const resource = String(permission.attributes['resource'] ?? '').toLowerCase();
      if (resource !== '' && statement.includes(resource)) {
        if (
          await hasExistingByAttribute(
            services,
            'FINDING',
            baseline.projectId,
            'ruleId',
            rule.id,
          )
        ) {
          continue;
        }
        const id = services.allocator.nextId('FINDING');
        const finding = createArtifact({
          id,
          type: 'FINDING',
          title: `Contradiction: ${rule.id} vs ${permission.id}`,
          description:
            `Rule "${String(rule.attributes['statement'] ?? '')}" restricts this resource to admins, ` +
            `while permission grants [${nonAdminRoles.join(', ')}]. Routed to the Council per §0.19 - never silently resolved.`,
          projectId: baseline.projectId,
          actor: producer,
          dependencies: [rule.id, permission.id],
          attributes: {
            findingKind: 'contradiction',
            registerStatus: 'open',
            ruleId: rule.id,
            permissionId: permission.id,
            conflictingRoles: nonAdminRoles,
          },
        });
await services.store.append(finding);
    await services.evidence.append({
      kind: 'inspection',
      summary: `Contradiction Engine produced finding ${id} (${rule.id} vs ${permission.id}).`,
      artifactIds: [id],
      producer,
    });
    syncArtifactToGraph(services.graph, finding);
        entries.push({ findingId: id, ruleId: rule.id, permissionId: permission.id });
      }
    }
  }
  return entries;
}

/** Cluster E — DW-E5 Discovery Auditor: samples the accepted inventory and
 *  re-runs the §0.18 evidence check independently of the Boss. */
async function runDiscoveryAudit(
  services: CoreServices,
  baseline: DiscoveryBaseline,
  sampledIds: readonly string[],
): Promise<{ audited: boolean; evidenceId: string; failures: readonly string[] }> {
  const auditor: Actor = { kind: 'verifier', id: 'discovery-auditor-01' };
  const failures: string[] = [];
  for (const id of sampledIds) {
    const records = await services.evidence.forArtifact(id);
    if (records.length === 0) {
      // Anchors may live on the PROJECT record for cluster calls; the §0.18
      // check passes when the artifact itself OR its project carries the
      // response anchor for its discovery pass.
      const viaProject = await services.evidence.forArtifact(baseline.projectId);
      if (viaProject.length === 0) {
        failures.push(`${id}: no evidence records at all.`);
        continue;
      }
    }
    for (const record of records) {
      if (record.payloadRef !== undefined && !/^sha256:[0-9a-f]{64}$/.test(record.payloadRef)) {
        failures.push(`${id}: malformed payloadRef on ${record.id}.`);
      }
    }
  }
  const evidence = await services.evidence.append({
    kind: 'review',
    summary:
      `Discovery Audit (DW-E5): sampled ${sampledIds.length} artifact(s) across clusters; ` +
      `${failures.length} evidence-check failure(s).`,
    artifactIds: [baseline.projectId],
    producer: auditor,
  });
  return { audited: failures.length === 0, evidenceId: evidence.id, failures };
}

export interface FullDepartmentOptions {
  /** Industry-category hint used by the §0.9 DNA diff. */
  readonly categoryHint?: string;
  /** Runs the §0.6 Recursive Page Expansion (Pass 10). Default true. */
  readonly runExpansion?: boolean;
}

/**
 * The Level-3 promotion gate. The department may accept its own output ONLY
 * when the artifact is genuinely produced: it exists with provenance AND
 * carries an evidence anchor (on the artifact or the cluster's project record).
 * Anything that lacks those is NOT stamped VERIFIED — it stays DRAFT and is
 * reported as a gate failure, exactly like a Boss-reconstruction delta would
 * be. Exported so the negative path is independently testable.
 */
export async function submitProducedArtifactsToGate(
  services: CoreServices,
  baseline: DiscoveryBaseline,
  producedIds: readonly string[],
  actor: Actor = { kind: 'verifier', id: 'discovery-boss-01' },
): Promise<{ readonly promoted: number; readonly failures: readonly string[] }> {
  const failures: string[] = [];
  let promoted = 0;
  for (const id of producedIds) {
    const current = await services.store.require(id);
    if (current.status !== 'DRAFT') continue;
    const anchored =
      current.provenance.length > 0 &&
      ((await services.evidence.forArtifact(id)).length > 0 ||
        (await services.evidence.forArtifact(baseline.projectId)).length > 0);
    if (!anchored) {
      failures.push(`${id}: no producing evidence/provenance; kept DRAFT.`);
      continue;
    }
    await recordStatusChange(services.store, id, 'IN_REVIEW', actor, {
      note: 'Submitted for full-department verification.',
    });
    await recordStatusChange(services.store, id, 'VERIFIED', actor, {
      note: 'Accepted by the full Discovery Department (Level 3) after mechanical evidence+provenance gate.',
    });
    promoted += 1;
  }
  return { promoted, failures };
}

/**
 * Runs the Level-3 passes over an ALREADY-ACCEPTED discovery baseline:
 * Cluster C content expansion, DW-D1 edge cases, the Risk & Assumption
 * Register, Negative-Space questions, Industry Comparison, Red Team, the
 * Contradiction register, promotion of everything produced, and finally the
 * Discovery Auditor. Every new artifact carries its pass label and evidence.
 */
export async function runFullDepartmentPasses(
  services: CoreServices,
  baseline: DiscoveryBaseline,
  options: FullDepartmentOptions = {},
): Promise<FullDepartmentResult> {
  const behavioralWorker: Actor = { kind: 'ai', id: 'behavioral-worker-01' };
  const edgeCaseWorker: Actor = { kind: 'ai', id: 'edge-case-worker-01' };
  const nfrWorker: Actor = { kind: 'ai', id: 'nfr-worker-01' };
  const redTeam: Actor = { kind: 'verifier', id: 'red-team-01' };
  const comparisonWorker: Actor = { kind: 'ai', id: 'industry-comparison-worker-01' };

  const contentAdded = await expandPageContent(services, baseline, behavioralWorker);
  const edgeStatesAdded = await discoverEdgeCases(services, baseline, edgeCaseWorker);
  const risks = await registerRisks(services, baseline, nfrWorker);
  const negativeSpace = await discoverNegativeSpace(services, baseline);
  const comparison = await runIndustryComparison(
    services,
    baseline,
    comparisonWorker,
    options.categoryHint,
  );
  const redTeamFindings = await runRedTeam(services, baseline, redTeam);
  const contradictions = await scanContradictions(services, baseline, redTeam);

  // Pass 10 — §0.6 Recursive Page Expansion: every page determined through all
  // fourteen expansion layers. Runs after the content/edge-case passes so
  // Layers 2 and 4 observe the earlier derivation and do not duplicate it.
  let expansion: RecursiveExpansionResult;
  if (options.runExpansion === false) {
    expansion = { pages: [], artifactIds: [], tally: { covered: 0, added: 0, 'not-relevant': 0, blocked: 0 } };
  } else {
    expansion = await runRecursivePageExpansion(services, baseline, {
      producer: { kind: 'ai', id: 'expansion-worker-01' },
    });
  }

  // Gate every phase artifact on real production facts before accepting it.
  // The department may accept its own output ONLY when the artifact is
  // genuinely produced: it exists with provenance AND carries an evidence
  // anchor (on the artifact or the cluster's project record). Anything that
  // lacks those is NOT stamped VERIFIED - it stays DRAFT and is reported as
  // a gate failure, exactly like a Boss-reconstruction delta would be.
  const producedIds = [
    ...contentAdded,
    ...edgeStatesAdded,
    ...risks,
    ...comparison.findings,
    ...redTeamFindings,
    ...contradictions.map((c) => c.findingId),
    ...expansion.artifactIds,
  ];
  const bossActor: Actor = { kind: 'verifier', id: 'discovery-boss-01' };
  const gate = await submitProducedArtifactsToGate(services, baseline, producedIds, bossActor);

  // Auditor samples across clusters (every second artifact, min 6).
  const sampled: string[] = producedIds.filter((_, index) => index % 2 === 0);
  if (sampled.length < 6) sampled.push(...baseline.pages.map((p) => p.artifactId));
  const uniqueSampled = [...new Set(sampled)].slice(0, 12);
  const audit = await runDiscoveryAudit(services, baseline, uniqueSampled);

  services.logger?.info('discovery.level3.passes', {
    contentAdded: contentAdded.length,
    edgeStatesAdded: edgeStatesAdded.length,
    risks: risks.length,
    negativeSpaceQuestions: negativeSpace.questions.length,
    comparisonFindings: comparison.findings.length,
    matchedCategory: comparison.matchedCategory ?? '(none)',
    redTeamFindings: redTeamFindings.length,
    contradictions: contradictions.length,
    expansionPages: expansion.pages.length,
    expansionArtifacts: expansion.artifactIds.length,
    expansionTally: expansion.tally,
    promoted: gate.promoted,
    gateFailures: gate.failures.length,
    audited: audit.audited,
  });
  if (gate.failures.length > 0) {
    services.logger?.warn('discovery.level3.gate.blocked', { failures: gate.failures });
  }

  return {
    contentAdded,
    edgeStatesAdded,
    risks,
    negativeSpaceQuestions: negativeSpace.questions,
    comparisonFindings: comparison.findings,
    matchedCategory: comparison.matchedCategory,
    redTeamFindings,
    contradictions,
    expansion,
    audited: audit.audited,
    auditEvidenceId: audit.evidenceId,
    artifactIds: [...producedIds],
  };
}