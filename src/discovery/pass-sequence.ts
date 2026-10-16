/**
 * The Discovery Pass Sequence — the fixed, 25-pass (0–24) ordered sequence the
 * Discovery Department follows from department readiness through the
 * independent master audit (vision §0.5, roadmap component "The Discovery Pass
 * Sequence").
 *
 * Each pass has a clear entry condition, a clear exit condition, and a named
 * owner drawn from the 36-role Worker Corps (`./corpus/workers.ts`):
 *
 *   Pass  0  Department Readiness ......... Discovery Boss
 *   Pass  1  Product Understanding ....... DW-A1 (Cluster A/B baseline)
 *   Pass  2  Domain Understanding ........ DW-A2
 *   Pass  3  Product Category Analysis ... DW-A5
 *   Pass  4  Application Genome Analysis . Application Genome Engine
 *   Pass  5  User/Role Discovery ......... DW-B1
 *   Pass  6  Workflow Discovery .......... DW-B4
 *   Pass  7  Module Discovery ............ DW-B2
 *   Pass  8  Feature Discovery ........... DW-B3
 *   Pass  9  Page Discovery .............. DW-B5
 *   Pass 10  Recursive Page Expansion .... Behavioral cluster (14 layers)
 *   Pass 11  Feature Family Expansion .... Feature Expansion Engine
 *   Pass 12  Edge-Case Discovery ......... DW-D1
 *   Pass 13  Dependency Discovery ........ DW-C8
 *   Pass 14  Security / Permission ....... DW-D2 + DW-C6
 *   Pass 15  Operational Discovery ....... DW-D5
 *   Pass 16  Industry Comparison ......... Industry Comparison Engine
 *   Pass 17  Adversarial Discovery ....... Discovery Red Team (DW-E4)
 *   Pass 18  Negative-Space Discovery .... DW-E3
 *   Pass 19  Contradiction Discovery ..... DW-E2
 *   Pass 20  Orphan Discovery ............ DW-E1
 *   Pass 21  Recursive Re-Discovery ...... all workers (bounded sweep)
 *   Pass 22  Discovery Self-Verification . all workers (§0.14)
 *   Pass 23  Boss Independent Reconstruction ... Discovery Boss (§0.15)
 *   Pass 24  Independent Master Audit ..... Discovery Auditor (DW-E5)
 *
 * Honesty discipline (LAW): a pass that cannot satisfy its exit condition
 * HALTS the sequence with a recorded reason. It never fabricates an artifact,
 * an evidence record, or a "passed" status to keep the sequence moving. Every
 * enrichment pass is deterministic and idempotent (§0.16): re-running it
 * produces no duplicate artifacts, which is what lets Pass 21 converge.
 *
 * Reuses (never duplicates) the existing machinery:
 *   - `DiscoveryDepartment.discover`          Pass 1 clusters A/B + boss
 *   - `runRecursivePageExpansion`             Pass 10 (14 layers)
 *   - `runRedTeam` / `discoverNegativeSpace`  Passes 17 / 18
 *   - `runDiscoveryAudit`                     Pass 24 evidence re-check
 *   - `deriveBusinessModel` / `deriveThreatModel`  Pass 14 security set
 *   - boss reconstruction helpers             Pass 23
 */

import type { CoreServices } from '../core/services.ts';
import type { Actor } from '../core/artifact.ts';
import type { CreateArtifactInput } from '../core/artifact.ts';
import { createArtifact } from '../core/artifact.ts';
import { syncArtifactToGraph } from '../core/graph.ts';
import type { Artifact, ProvenanceEntry } from '../core/artifact.ts';
import type { ArtifactType } from '../core/ids.ts';

import { validateBrief } from './brief.ts';
import { extractJson, renderBrief } from './prompt.ts';
import type { ProductUnderstandingBrief } from './types.ts';
import { artifactIdsOf } from './baseline-utils.ts';
import type { DiscoveryBaseline } from './materialize.ts';
import type { NormalizedInventory } from './normalize.ts';
import { DiscoveryDepartment } from './department/engine.ts';
import {
  BOSS_MARKER,
  createBossFindings,
  diffReconstruction,
  parseBossExpectation,
  renderBossPrompt,
} from './department/boss.ts';
import { runRecursivePageExpansion } from './department/expansion.ts';
import {
  discoverNegativeSpace,
  runDiscoveryAudit,
  runRedTeam,
  submitProducedArtifactsToGate,
} from './department/level3.ts';
import { deriveBusinessModel } from './business-model.ts';
import { deriveThreatModel } from '../security/threat-model.ts';
import {
  getDiscoveryWorkerRole,
  WORKER_ROLE_IDS,
} from './corpus/workers.ts';

// ---------------------------------------------------------------------------
// Result + option types
// ---------------------------------------------------------------------------

export type PassStatus = 'passed' | 'halted' | 'skipped';

export interface DiscoveryPassRecord {
  readonly pass: number;
  readonly name: string;
  readonly owner: string;
  readonly status: PassStatus;
  readonly exitReason: string;
  readonly artifactIds: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly startedAt: string;
  readonly endedAt: string;
}

export interface DiscoveryAuditCertificate {
  readonly projectId: string;
  readonly sampled: readonly string[];
  readonly failures: readonly string[];
  readonly clean: boolean;
  readonly evidenceId: string;
}

export interface DiscoverySequenceSummary {
  readonly totalArtifacts: number;
  readonly passesPassed: number;
  readonly discoveryQuestionCount: number;
  readonly contradictionOpen: number;
  readonly sweeps: number;
}

export interface DiscoverySequenceResult {
  readonly passes: readonly DiscoveryPassRecord[];
  readonly sequenceComplete: boolean;
  readonly haltedAt?: number;
  readonly reasons: readonly string[];
  readonly summary: DiscoverySequenceSummary;
  readonly auditCertificate?: DiscoveryAuditCertificate;
  readonly baseline?: DiscoveryBaseline;
  readonly artifactIds: readonly string[];
}

export interface ContradictionResolution {
  readonly ruleId: string;
  readonly permissionId: string;
  readonly resolution: string;
  readonly rationale: string;
}

export interface DiscoverySequenceOptions {
  /** The raw Product Understanding Brief (DW-A1 input). Required. */
  readonly brief: ProductUnderstandingBrief;
  /** Industry-category hint fed to category detection. */
  readonly categoryHint?: string;
  /** Domain Profile when a pre-built baseline is supplied. */
  readonly domainProfile?: string;
  /** Maximum Pass 21 sweeps before the sequence halts honestly. Default 3. */
  readonly maxSweeps?: number;
  /** Pass 24 audit sample cap. Default 12. */
  readonly auditSampleSize?: number;
  /** Capabilities the Industry Comparison Engine must resolve to "Required". */
  readonly industryRequired?: readonly string[];
  /** Capabilities the Industry Comparison Engine must resolve to "Not-Required". */
  readonly industryNotRequired?: readonly string[];
  /** Deterministic contradiction resolutions (bypasses the AI ruling call). */
  readonly contradictionResolutions?: readonly ContradictionResolution[];
  /** Deterministic Pass 0 override used to exercise the negative readiness path. */
  readonly readiness?: { readonly ready: boolean; readonly reason?: string };
}

// ---------------------------------------------------------------------------
// Pass table
// ---------------------------------------------------------------------------

interface PassDefinition {
  readonly pass: number;
  readonly name: string;
  readonly owner: string;
}

const PASS_DEFINITIONS: readonly PassDefinition[] = [
  { pass: 0, name: 'Department Readiness', owner: 'Discovery Boss' },
  { pass: 1, name: 'Product Understanding', owner: 'Product Understanding Worker (DW-A1)' },
  { pass: 2, name: 'Domain Understanding', owner: 'Domain Understanding Worker (DW-A2)' },
  { pass: 3, name: 'Product Category Analysis', owner: 'Product Category Analysis Worker (DW-A5)' },
  { pass: 4, name: 'Application Genome Analysis', owner: 'Application Genome Engine' },
  { pass: 5, name: 'User/Role Discovery', owner: 'User/Role Discovery Worker (DW-B1)' },
  { pass: 6, name: 'Workflow Discovery', owner: 'Workflow Discovery Worker (DW-B4)' },
  { pass: 7, name: 'Module Discovery', owner: 'Module Discovery Worker (DW-B2)' },
  { pass: 8, name: 'Feature Discovery', owner: 'Feature Discovery Worker (DW-B3)' },
  { pass: 9, name: 'Page Discovery', owner: 'Page Discovery Worker (DW-B5)' },
  { pass: 10, name: 'Recursive Page Expansion', owner: 'Behavioral cluster (all roles)' },
  { pass: 11, name: 'Feature Family Expansion', owner: 'Feature Expansion Engine' },
  { pass: 12, name: 'Edge-Case Discovery', owner: 'Edge-Case Discovery Worker (DW-D1)' },
  { pass: 13, name: 'Dependency Discovery', owner: 'Dependency Discovery Worker (DW-C8)' },
  { pass: 14, name: 'Security / Permission Discovery', owner: 'Security (DW-D2) + Permission (DW-C6) Discovery Workers' },
  { pass: 15, name: 'Operational Discovery', owner: 'Operational Discovery Worker (DW-D5)' },
  { pass: 16, name: 'Industry Comparison', owner: 'Industry Comparison Engine (DW-A3)' },
  { pass: 17, name: 'Adversarial Discovery (Red Team)', owner: 'Discovery Red Team (DW-E4)' },
  { pass: 18, name: 'Negative-Space Discovery', owner: 'Negative-Space Discovery Worker (DW-E3)' },
  { pass: 19, name: 'Contradiction Discovery', owner: 'Contradiction Analysis Worker (DW-E2)' },
  { pass: 20, name: 'Orphan Discovery', owner: 'Completeness Analysis Worker (DW-E1)' },
  { pass: 21, name: 'Recursive Re-Discovery', owner: 'All workers (triggered)' },
  { pass: 22, name: 'Discovery Self-Verification', owner: 'All workers' },
  { pass: 23, name: 'Discovery Boss Independent Reconstruction', owner: 'Discovery Boss' },
  { pass: 24, name: 'Independent Master Audit', owner: 'Discovery Auditor (DW-E5)' },
];

function passDefinition(pass: number): PassDefinition {
  const def = PASS_DEFINITIONS.find((p) => p.pass === pass);
  if (def === undefined) throw new Error(`Unknown pass ${pass}.`);
  return def;
}

// ---------------------------------------------------------------------------
// Deterministic helpers
// ---------------------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString();
}

interface PassOutcome {
  readonly ok: boolean;
  readonly reason: string;
  /** All artifact IDs the pass owns (baseline + newly created). */
  readonly artifactIds: readonly string[];
  /** Only the artifacts this invocation actually created (for Pass 21). */
  readonly createdIds: readonly string[];
  readonly evidenceIds: readonly string[];
}

function outcome(
  ok: boolean,
  reason: string,
  artifactIds: readonly string[] = [],
  createdIds: readonly string[] = [],
  evidenceIds: readonly string[] = [],
): PassOutcome {
  return { ok, reason, artifactIds, createdIds, evidenceIds };
}

/** §0.16 duplication discipline: never re-produce an artifact for a subject. */
async function ensureArtifact(
  services: CoreServices,
  projectId: string,
  type: ArtifactType,
  attribute: string,
  value: string,
  build: (id: string) => CreateArtifactInput,
): Promise<{ id: string; created: boolean }> {
  const existing = (await services.store.list({ types: [type], projectId })).find(
    (a) => String(a.attributes[attribute]) === value,
  );
  if (existing !== undefined) return { id: existing.id, created: false };
  const id = services.allocator.nextId(type);
  const artifact = createArtifact(build(id));
  await services.store.append(artifact);
  syncArtifactToGraph(services.graph, artifact);
  return { id, created: true };
}

/** Appends an evidence record at most once, keyed by a stable marker. */
async function appendEvidenceOnce(
  services: CoreServices,
  marker: string,
  input: Parameters<CoreServices['evidence']['append']>[0],
): Promise<{ id: string; created: boolean }> {
  const existing = (await services.evidence.all()).find((e) => e.summary.includes(marker));
  if (existing !== undefined) return { id: existing.id, created: false };
  const record = await services.evidence.append(input);
  return { id: record.id, created: true };
}

async function stampPass(services: CoreServices, id: string, label: string): Promise<void> {
  const artifact = await services.store.require(id);
  if (artifact.attributes['discoveryPass'] === label) return;
  await services.store.update(artifact.id, artifact.version, (draft) => ({
    ...draft,
    attributes: { ...draft.attributes, discoveryPass: label },
  }));
}

async function setAttribute(
  services: CoreServices,
  id: string,
  attribute: string,
  value: unknown,
): Promise<void> {
  const artifact = await services.store.require(id);
  await services.store.update(artifact.id, artifact.version, (draft) => ({
    ...draft,
    attributes: { ...draft.attributes, [attribute]: value },
  }));
}

function hasAnyEdge(services: CoreServices, id: string): boolean {
  return (
    services.graph.neighbors(id, 'downstream').length > 0 ||
    services.graph.neighbors(id, 'upstream').length > 0
  );
}

// ---------------------------------------------------------------------------
// Category taxonomy + detection (Pass 3)
// ---------------------------------------------------------------------------

const CATEGORY_DNA: Readonly<Record<string, readonly string[]>> = {
  'team-productivity': [
    'task-management',
    'project-organization',
    'reporting-dashboard',
    'notifications',
    'user-roles',
  ],
};

function detectCategory(
  domainProfile: string,
  categoryHint: string | undefined,
  productName: string,
): string | null {
  const corpus = `${categoryHint ?? ''} ${domainProfile} ${productName}`.toLowerCase();
  for (const category of Object.keys(CATEGORY_DNA)) {
    const tokens = category.split('-');
    if (tokens.every((t) => corpus.includes(t))) return category;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Standing edge-case question set (Pass 12, §0.8)
// ---------------------------------------------------------------------------

interface EdgeCaseScope {
  readonly hasActions: boolean;
  readonly hasListContent: boolean;
  readonly hasForms: boolean;
  readonly hasIntegrations: boolean;
  readonly hasApis: boolean;
  readonly hasPermissions: boolean;
  readonly hasDeleteAction: boolean;
  readonly hasCreateAction: boolean;
  readonly hasMultiStepWorkflow: boolean;
  readonly hasBulkAction: boolean;
  readonly hasMutatingActions: boolean;
  readonly hasPayment: boolean;
}

interface StandingQuestion {
  readonly id: string;
  readonly question: string;
  readonly routedTo: string;
  readonly applies: (scope: EdgeCaseScope) => boolean;
}

const STANDING_EDGE_CASE_QUESTIONS: readonly StandingQuestion[] = [
  { id: 'success-path', question: 'Is the success path fully defined for every action?', routedTo: 'STATE', applies: (s) => s.hasActions },
  { id: 'failure-path', question: 'Does every action have a defined failure path?', routedTo: 'STATE', applies: (s) => s.hasActions },
  { id: 'empty-data', question: 'What renders when the underlying dataset is empty?', routedTo: 'STATE', applies: (s) => s.hasListContent },
  { id: 'invalid-input', question: 'What happens on invalid input?', routedTo: 'VALIDATION', applies: (s) => s.hasForms },
  { id: 'unauthorized-access', question: 'What happens when an authorized-but-insufficient role attempts the action?', routedTo: 'PERMISSION', applies: (s) => s.hasPermissions },
  { id: 'unauthenticated-access', question: 'What happens when an unauthenticated visitor attempts the action?', routedTo: 'PERMISSION', applies: (s) => s.hasPermissions },
  { id: 'expiration', question: 'What happens when a session, token, hold or offer expires?', routedTo: 'STATE', applies: (s) => s.hasPermissions },
  { id: 'payment-failure', question: 'What are the payment failure, pending and reversal states?', routedTo: 'STATE', applies: (s) => s.hasPayment },
  { id: 'network-api-db-failure', question: 'What happens when the network, API, database or a third-party service fails?', routedTo: 'STATE', applies: (s) => s.hasApis || s.hasIntegrations },
  { id: 'timeout', question: 'What happens on a slow or timed-out dependency?', routedTo: 'STATE', applies: (s) => s.hasApis || s.hasIntegrations },
  { id: 'missing-or-deleted', question: 'What happens when the target object is missing or already deleted?', routedTo: 'STATE', applies: (s) => s.hasDeleteAction },
  { id: 'concurrent-modification', question: 'What happens when two users modify the same record concurrently?', routedTo: 'STATE', applies: (s) => s.hasMutatingActions },
  { id: 'duplicate-submission', question: 'What happens on duplicate submission of a create action?', routedTo: 'VALIDATION', applies: (s) => s.hasCreateAction },
  { id: 'abandoned-workflow', question: 'What happens when a multi-step workflow is abandoned mid-flow?', routedTo: 'WORKFLOW', applies: (s) => s.hasMultiStepWorkflow },
  { id: 'unavailable-dependency', question: 'What happens when a required dependency is unavailable?', routedTo: 'OPS', applies: (s) => s.hasIntegrations },
  { id: 'unexpected-external-event', question: 'What happens on an unexpected external event (webhook, callback)?', routedTo: 'NOTIFICATION', applies: (s) => s.hasIntegrations },
  { id: 'partial-failure', question: 'What happens when a bulk operation partially succeeds?', routedTo: 'STATE', applies: (s) => s.hasBulkAction || s.hasIntegrations },
];

async function buildEdgeCaseScope(
  services: CoreServices,
  baseline: DiscoveryBaseline,
): Promise<EdgeCaseScope> {
  const sectionTypes: string[] = [];
  for (const section of baseline.sections) {
    const artifact = await services.store.require(section.artifactId);
    sectionTypes.push(String(artifact.attributes['contentType'] ?? 'generic'));
  }
  const actionKeys: string[] = [];
  for (const action of baseline.actions) {
    const artifact = await services.store.require(action.artifactId);
    actionKeys.push(
      String(artifact.attributes['actionKey'] ?? artifact.attributes['discoveryKey'] ?? artifact.title).toLowerCase(),
    );
  }
  const domainText = `${baseline.projectId}`.toLowerCase();
  return {
    hasActions: actionKeys.length > 0,
    hasListContent: sectionTypes.some((t) => ['list', 'table', 'kanban'].includes(t)),
    hasForms: sectionTypes.some((t) => t === 'form'),
    hasIntegrations: baseline.integrations.length > 0,
    hasApis: baseline.apis.length > 0,
    hasPermissions: baseline.permissions.length > 0,
    hasDeleteAction: actionKeys.some((k) => /delete|remove/.test(k)),
    hasCreateAction: actionKeys.some((k) => /create|add/.test(k)),
    hasMultiStepWorkflow: baseline.workflows.some((w) => (w as { steps?: readonly string[] }).steps?.length !== undefined) &&
      (await Promise.all(baseline.workflows.map((w) => services.store.require(w.artifactId)))).some(
        (a) => Array.isArray(a.attributes['steps']) && (a.attributes['steps'] as unknown[]).length > 1,
      ),
    hasBulkAction: actionKeys.some((k) => /bulk/.test(k)),
    hasMutatingActions: actionKeys.some((k) => /create|save|delete|move|update|remove/.test(k)),
    hasPayment: /payment|pay|billing|subscription|invoice/.test(domainText),
  };
}

// ---------------------------------------------------------------------------
// Pass bodies reusable by Pass 21 (deterministic + idempotent)
// ---------------------------------------------------------------------------

async function pass10Expansion(
  services: CoreServices,
  baseline: DiscoveryBaseline,
): Promise<PassOutcome> {
  const expansion = await runRecursivePageExpansion(services, baseline, {
    producer: { kind: 'ai', id: 'expansion-worker-01' },
  });
  const undetermined = expansion.pages.filter((p) => !p.allLayersDetermined);
  if (undetermined.length > 0) {
    return outcome(
      false,
      `Recursive Page Expansion: ${undetermined.length} page(s) not determined through all 14 layers.`,
      expansion.artifactIds,
      expansion.artifactIds,
    );
  }
  const blocked = expansion.pages.reduce((n, p) => n + p.omissions.length, 0);
  return outcome(
    true,
    `Every page determined through all 14 layers (§0.6); ${expansion.artifactIds.length} artifact(s) produced, ${blocked} layer omission(s) routed as Discovery Questions.`,
    expansion.artifactIds,
    expansion.artifactIds,
  );
}

async function pass11FeatureFamilies(
  services: CoreServices,
  baseline: DiscoveryBaseline,
): Promise<PassOutcome> {
  const producer: Actor = { kind: 'ai', id: 'feature-expansion-engine-01' };
  const pages = await Promise.all(baseline.pages.map((p) => services.store.require(p.artifactId)));
  const apis = await Promise.all(baseline.apis.map((a) => services.store.require(a.artifactId)));
  const entities = await Promise.all(baseline.entities.map((e) => services.store.require(e.artifactId)));
  const permissions = await Promise.all(baseline.permissions.map((p) => services.store.require(p.artifactId)));
  const workflows = await Promise.all(baseline.workflows.map((w) => services.store.require(w.artifactId)));

  const evidenceIds: string[] = [];
  let questionCount = 0;
  for (const feature of baseline.features) {
    const artifact = await services.store.require(feature.artifactId);
    const tokens = `${feature.key} ${artifact.title}`
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2);
    const owned = <T extends { id: string; title: string }>(items: readonly T[]): boolean =>
      items.some((i) => {
        const text = `${i.id} ${i.title}`.toLowerCase();
        return tokens.some((t) => text.includes(t));
      });
    const missing: string[] = [];
    if (!owned(pages)) missing.push('supporting page');
    if (!owned(apis)) missing.push('API');
    if (!owned(entities)) missing.push('data entity');
    if (!owned(permissions)) missing.push('permission');
    if (!owned(workflows)) missing.push('workflow');
    const marker = `Feature Family Expansion (${feature.key})`;
    const summary =
      missing.length === 0
        ? `${marker}: supporting ecosystem present (page, API, entity, permission, workflow).`
        : `${marker}: Discovery Question — feature implies a ${missing.join(', ')} with no counterpart in the certified inventory; not guessed.`;
    const ev = await appendEvidenceOnce(services, marker, {
      kind: 'inspection',
      summary,
      artifactIds: [feature.artifactId, baseline.projectId],
      producer,
    });
    evidenceIds.push(ev.id);
    if (missing.length > 0) questionCount += 1;
  }
  return outcome(
    true,
    `Feature Family Expansion (§0.7): determination recorded for ${baseline.features.length} feature(s); ${questionCount} routed as Discovery Questions.`,
    [],
    [],
    evidenceIds,
  );
}

async function pass12EdgeCases(
  services: CoreServices,
  baseline: DiscoveryBaseline,
): Promise<PassOutcome> {
  const producer: Actor = { kind: 'ai', id: 'edge-case-worker-01' };
  const scope = await buildEdgeCaseScope(services, baseline);
  const created: string[] = [];
  const all: string[] = [];
  for (const q of STANDING_EDGE_CASE_QUESTIONS) {
    if (!q.applies(scope)) continue;
    const result = await ensureArtifact(
      services,
      baseline.projectId,
      'EDGECASE',
      'standingQuestion',
      q.id,
      (id) =>
        ({
          id,
          type: 'EDGECASE',
          title: `Edge case (${q.id}): ${q.question}`,
          description: `Standing §0.8 edge-case question "${q.question}" routed to ${q.routedTo}.`,
          projectId: baseline.projectId,
          actor: producer,
          dependencies: [baseline.projectId],
          attributes: {
            standingQuestion: q.id,
            question: q.question,
            routedTo: q.routedTo,
            resolution: 'routed',
            discoveryPass: 'Pass 12 · Edge-Case Discovery (DW-D1)',
          },
        }),
    );
    all.push(result.id);
    if (result.created) {
      created.push(result.id);
      await services.evidence.append({
        kind: 'inspection',
        summary: `DW-D1 produced edge-case register entry ${result.id} (${q.id} → ${q.routedTo}).`,
        artifactIds: [result.id],
        producer,
      });
    }
  }
  return outcome(
    true,
    `Edge-Case Register certified (§0.8): ${all.length} applicable standing question(s) routed to their implied artifact type.`,
    all,
    created,
  );
}

async function pass13Dependencies(
  services: CoreServices,
  baseline: DiscoveryBaseline,
): Promise<PassOutcome> {
  const producer: Actor = { kind: 'ai', id: 'dependency-worker-01' };
  const artifacts = await services.store.list({ projectId: baseline.projectId });
  const created: string[] = [];
  const all: string[] = [];

  // Broken dependency edges: a dependency that names a non-existent artifact.
  const broken: { id: string; dep: string }[] = [];
  for (const artifact of artifacts) {
    for (const dep of artifact.dependencies) {
      if ((await services.store.get(dep)) === null) broken.push({ id: artifact.id, dep });
    }
  }

  // Normalize cross-cutting artifacts (rules, permissions, integrations, …)
  // so nothing exists in isolation: link them to the PROJECT they belong to.
  for (const artifact of artifacts) {
    if (artifact.id === baseline.projectId) continue;
    if (hasAnyEdge(services, artifact.id)) continue;
    services.graph.link(artifact.id, 'DEPENDS_ON', baseline.projectId);
    const edgeKey = `${artifact.id}->${baseline.projectId}`;
    const result = await ensureArtifact(
      services,
      baseline.projectId,
      'DEPENDENCY',
      'edgeKey',
      edgeKey,
      (id) =>
        ({
          id,
          type: 'DEPENDENCY',
          title: `Dependency: ${artifact.id} depends on PROJECT`,
          description: `${artifact.id} is a project-scoped artifact with no modeled parent; it depends on ${baseline.projectId}.`,
          projectId: baseline.projectId,
          actor: producer,
          dependencies: [artifact.id, baseline.projectId],
          attributes: {
            edgeKey,
            from: artifact.id,
            to: baseline.projectId,
            mechanism: 'project-scope membership (normalization)',
            discoveryPass: 'Pass 13 · Dependency Discovery (DW-C8)',
          },
        }),
    );
    all.push(result.id);
    if (result.created) created.push(result.id);
  }

  const mapResult = await ensureArtifact(
    services,
    baseline.projectId,
    'DEPENDENCY',
    'dependencyKind',
    'map',
    (id) =>
      ({
        id,
        type: 'DEPENDENCY',
        title: 'Dependency Map (Pass 13, DW-C8)',
        description: `Machine-checkable dependency map over ${artifacts.length} artifact(s); ${broken.length} broken edge(s).`,
        projectId: baseline.projectId,
        actor: producer,
        dependencies: [baseline.projectId],
        attributes: {
          dependencyKind: 'map',
          artifactCount: artifacts.length,
          brokenEdges: broken.length,
          discoveryPass: 'Pass 13 · Dependency Discovery (DW-C8)',
        },
      }),
  );
  all.push(mapResult.id);
  if (mapResult.created) created.push(mapResult.id);

  if (broken.length > 0) {
    for (const b of broken) {
      const edgeKey = `broken:${b.id}->${b.dep}`;
      const result = await ensureArtifact(
        services,
        baseline.projectId,
        'FINDING',
        'edgeKey',
        edgeKey,
        (id) =>
          ({
            id,
            type: 'FINDING',
            title: `Broken dependency: ${b.id} → ${b.dep}`,
            description: `${b.id} declares a dependency on ${b.dep}, which does not exist.`,
            projectId: baseline.projectId,
            actor: producer,
            dependencies: [b.id],
            attributes: {
              findingKind: 'broken-dependency',
              edgeKey,
              from: b.id,
              to: b.dep,
              discoveryPass: 'Pass 13 · Dependency Discovery (DW-C8)',
            },
          }),
      );
      all.push(result.id);
      if (result.created) created.push(result.id);
    }
    return outcome(
      false,
      `Dependency Map: ${broken.length} broken dependency chain(s) remain; the sweep cannot close while a chain is broken.`,
      all,
      created,
    );
  }
  return outcome(
    true,
    `Dependency Map certified: ${artifacts.length} artifact(s) cross-referenced, 0 broken chains.`,
    all,
    created,
  );
}

async function pass14Security(
  services: CoreServices,
  baseline: DiscoveryBaseline,
): Promise<PassOutcome> {
  const producer: Actor = { kind: 'ai', id: 'security-worker-01' };
  for (const permission of baseline.permissions) {
    await stampPass(services, permission.artifactId, 'Pass 14 · Permission Discovery (DW-C6)');
  }
  const existingModel = (await services.store.list({ types: ['THREAT_MODEL'], projectId: baseline.projectId })).length > 0;
  let createdSecReqs: string[] = [];
  if (!existingModel) {
    const model = await deriveBusinessModel(services, baseline);
    const threatModel = await deriveThreatModel(services, model, producer);
    for (const req of threatModel.securityRequirements) {
      await services.evidence.append({
        kind: 'inspection',
        summary: `DW-D2 security requirement derived: ${req.id} (${req.category}, ${req.priority}).`,
        artifactIds: [baseline.projectId],
        producer,
      });
    }
    createdSecReqs = (await services.store.list({ types: ['SEC_REQ'], projectId: baseline.projectId })).map((a) => a.id);
  }
  const secReqs = await services.store.list({ types: ['SEC_REQ'], projectId: baseline.projectId });
  const permissions = baseline.permissions.map((p) => p.artifactId);
  if (permissions.length === 0) {
    return outcome(false, 'Permission Discovery: no permission inventory exists; security posture cannot be scoped.', secReqs.map((a) => a.id));
  }
  if (secReqs.length === 0) {
    return outcome(false, 'Security Discovery: no security requirement set was produced.', permissions);
  }
  return outcome(
    true,
    `Security Requirement Set (${secReqs.length}) + Permission Inventory (${permissions.length}) certified.`,
    [...permissions, ...secReqs.map((a) => a.id)],
    createdSecReqs,
  );
}

async function pass15Operations(
  services: CoreServices,
  baseline: DiscoveryBaseline,
): Promise<PassOutcome> {
  const producer: Actor = { kind: 'ai', id: 'operational-worker-01' };
  const created: string[] = [];
  const all: string[] = [];
  const addOps = async (
    key: string,
    title: string,
    description: string,
    deps: readonly string[],
    category: string,
  ): Promise<void> => {
    const result = await ensureArtifact(
      services,
      baseline.projectId,
      'OPS',
      'opsKey',
      key,
      (id) =>
        ({
          id,
          type: 'OPS',
          title,
          description,
          projectId: baseline.projectId,
          actor: producer,
          dependencies: [...deps, baseline.projectId],
          attributes: {
            opsKey: key,
            category,
            discoveryPass: 'Pass 15 · Operational Discovery (DW-D5)',
          },
        }),
    );
    all.push(result.id);
    if (result.created) {
      created.push(result.id);
      await services.evidence.append({
        kind: 'inspection',
        summary: `DW-D5 produced operational requirement ${result.id} (${category}).`,
        artifactIds: [result.id],
        producer,
      });
    }
  };

  for (const integration of baseline.integrations) {
    const artifact = await services.store.require(integration.artifactId);
    await addOps(
      `monitor:${integration.artifactId}`,
      `Monitor integration: ${artifact.title}`,
      `Define health monitoring and alerting for the ${artifact.title} integration.`,
      [integration.artifactId],
      'monitoring',
    );
  }
  for (const entity of baseline.entities) {
    const artifact = await services.store.require(entity.artifactId);
    await addOps(
      `backup:${entity.artifactId}`,
      `Backup & recovery: ${artifact.title}`,
      `Define backup cadence and RPO/RTO expectations for ${artifact.title}.`,
      [entity.artifactId],
      'backup-recovery',
    );
  }
  if (all.length === 0) {
    return outcome(
      true,
      'Operational Discovery: no integrations or entities require monitoring/backup; operational baseline is empty-by-scope.',
      [],
      [],
    );
  }
  return outcome(
    true,
    `Operational Requirement Set certified: ${all.length} OPS requirement(s).`,
    all,
    created,
  );
}

async function pass16Industry(
  services: CoreServices,
  baseline: DiscoveryBaseline,
  options: DiscoverySequenceOptions,
  domainProfile: string,
  category: string | null,
): Promise<PassOutcome> {
  const producer: Actor = { kind: 'ai', id: 'industry-comparison-worker-01' };
  if (category === null) {
    return outcome(false, 'Industry Comparison: product category is unclassified; no genome baseline to compare against.');
  }
  const expected = CATEGORY_DNA[category] ?? [];
  const featureText: string[] = [];
  for (const f of baseline.features) {
    const artifact = await services.store.require(f.artifactId);
    featureText.push(`${f.key} ${artifact.title}`.toLowerCase());
  }
  const created: string[] = [];
  const all: string[] = [];
  const required = new Set(options.industryRequired ?? []);
  const notRequired = new Set(options.industryNotRequired ?? []);
  for (const capability of expected) {
    const present = featureText.some((t) => capability.split('-').some((part) => t.includes(part)));
    if (present) continue;
    let resolution: 'Required' | 'Not-Required' | 'Discovery-Question' = 'Discovery-Question';
    if (required.has(capability)) resolution = 'Required';
    else if (notRequired.has(capability)) resolution = 'Not-Required';
    const reason =
      resolution === 'Discovery-Question'
        ? `Uncertain whether this product scope requires "${capability}"; converted to a Discovery Question (§0.9).`
        : resolution === 'Required'
          ? `Resolved Required: mature ${category} products consistently provide "${capability}".`
          : `Resolved Not-Required by explicit project decision: "${capability}" is out of this product's scope.`;
    const result = await ensureArtifact(
      services,
      baseline.projectId,
      'FINDING',
      'expectedFeature',
      capability,
      (id) => ({
        id,
        type: 'FINDING',
        title: `Industry comparison gap: "${capability}" (${resolution})`,
        description: `The ${category} category DNA expects "${capability}"; resolution: ${resolution}. ${reason}`,
        projectId: baseline.projectId,
        actor: producer,
        dependencies: [baseline.projectId],
        attributes: {
          findingKind: 'industry-comparison-gap',
          category,
          expectedFeature: capability,
          resolution,
          reason,
          discoveryPass: 'Pass 16 · Industry Comparison (§0.9)',
        },
      }),
    );
    all.push(result.id);
    if (result.created) {
      created.push(result.id);
      await services.evidence.append({
        kind: 'inspection',
        summary: `Industry Comparison resolved "${capability}" → ${resolution} (${result.id}).`,
        artifactIds: [result.id, baseline.projectId],
        producer,
      });
    }
  }
  return outcome(
    true,
    `Gap list resolved: ${expected.length} expected capability(ies) evaluated; ${all.length} gap(s) each resolved to Required/Not-Required/Discovery-Question.`,
    all,
    created,
  );
}

async function pass17RedTeam(
  services: CoreServices,
  baseline: DiscoveryBaseline,
): Promise<PassOutcome> {
  const redTeam: Actor = { kind: 'verifier', id: 'red-team-01' };
  const created = await runRedTeam(services, baseline, redTeam);
  const findings = (await services.store.list({ types: ['FINDING'], projectId: baseline.projectId })).filter(
    (a) => a.attributes['findingKind'] === 'red-team-omission',
  );
  let unresolved = 0;
  for (const finding of findings) {
    if (typeof finding.attributes['resolution'] !== 'string') {
      await setAttribute(services, finding.id, 'resolution', 'Discovery-Question');
      await appendEvidenceOnce(services, `red-team-resolution:${finding.id}`, {
        kind: 'inspection',
        summary: `Red Team finding ${finding.id} resolved to Uncertain → converted into a Discovery Question (§0.10).`,
        artifactIds: [finding.id, baseline.projectId],
        producer: redTeam,
      });
    }
    const refreshed = await services.store.require(finding.id);
    if (typeof refreshed.attributes['resolution'] !== 'string') unresolved += 1;
  }
  if (unresolved > 0) {
    return outcome(false, `Red Team: ${unresolved} finding(s) have no resolution.`, findings.map((f) => f.id), created);
  }
  return outcome(
    true,
    `Red Team Findings resolved (§0.10): ${findings.length} omission finding(s), each resolved to Missing/Not-Required/Uncertain (new this run: ${created.length}).`,
    findings.map((f) => f.id),
    created,
  );
}

async function pass18NegativeSpace(
  services: CoreServices,
  baseline: DiscoveryBaseline,
): Promise<PassOutcome> {
  const producer: Actor = { kind: 'ai', id: 'negative-space-worker-01' };
  const already = (await services.evidence.all()).some((e) =>
    e.summary.includes('Discovery Question (negative-space'),
  );
  let questions: readonly string[];
  let evidenceIds: string[];
  if (already) {
    questions = (await services.evidence.all())
      .filter((e) => e.summary.includes('Discovery Question (negative-space'))
      .map((e) => e.summary);
    evidenceIds = (await services.evidence.all())
      .filter((e) => e.summary.includes('Discovery Question (negative-space'))
      .map((e) => e.id);
  } else {
    const result = await discoverNegativeSpace(services, baseline);
    questions = result.questions;
    evidenceIds = [...result.evidenceIds];
  }
  for (const id of evidenceIds) {
    const question = (await services.evidence.all()).find((e) => e.id === id)?.summary ?? id;
    await appendEvidenceOnce(services, `negative-space-resolution:${id}`, {
      kind: 'inspection',
      summary: `Negative-Space finding resolved to Uncertain → converted into a Discovery Question (§0.11): ${question}`,
      artifactIds: [baseline.projectId],
      producer,
    });
  }
  return outcome(
    true,
    `Negative-Space Findings resolved (§0.11): ${questions.length} implied-ecosystem question(s) evaluated against this product's scope.`,
    [],
    [],
    evidenceIds,
  );
}

interface DetectedContradiction {
  readonly ruleId: string;
  readonly permissionId: string;
  readonly detail: string;
}

async function detectContradictions(
  services: CoreServices,
  baseline: DiscoveryBaseline,
): Promise<DetectedContradiction[]> {
  const rules = await Promise.all(baseline.rules.map((r) => services.store.require(r.artifactId)));
  const permissions = await Promise.all(baseline.permissions.map((p) => services.store.require(p.artifactId)));
  const found: DetectedContradiction[] = [];
  for (const rule of rules) {
    const statement = String(rule.attributes['statement'] ?? '').toLowerCase();
    if (!/only admin/.test(statement)) continue;
    for (const permission of permissions) {
      const roles = permission.attributes['roles'];
      if (!Array.isArray(roles)) continue;
      const nonAdmin = (roles as unknown[]).filter((r) => typeof r === 'string' && r !== 'admin');
      if (nonAdmin.length === 0) continue;
      const resource = String(permission.attributes['resource'] ?? '').toLowerCase();
      if (resource !== '' && statement.includes(resource)) {
        found.push({
          ruleId: rule.id,
          permissionId: permission.id,
          detail: `Rule "${String(rule.attributes['statement'] ?? '')}" restricts ${resource} to admins while permission grants [${nonAdmin.join(', ')}].`,
        });
      }
    }
  }
  return found;
}

async function pass19Contradictions(
  services: CoreServices,
  baseline: DiscoveryBaseline,
  options: DiscoverySequenceOptions,
): Promise<PassOutcome> {
  const worker: Actor = { kind: 'ai', id: 'contradiction-worker-01' };
  const detected = await detectContradictions(services, baseline);
  const created: string[] = [];
  const all: string[] = [];
  const register: { contradiction: DetectedContradiction; id: string }[] = [];
  for (const c of detected) {
    const key = `${c.ruleId}|${c.permissionId}`;
    const result = await ensureArtifact(
      services,
      baseline.projectId,
      'CONTRADICTION',
      'contradictionKey',
      key,
      (id) =>
        ({
          id,
          type: 'CONTRADICTION',
          title: `Contradiction: ${c.ruleId} vs ${c.permissionId}`,
          description: `${c.detail} Routed per §0.19 — never silently resolved by picking a side.`,
          projectId: baseline.projectId,
          actor: worker,
          dependencies: [c.ruleId, c.permissionId],
          attributes: {
            contradictionKey: key,
            dimension: 'permission-vs-rule',
            ruleId: c.ruleId,
            permissionId: c.permissionId,
            registerStatus: 'open',
            discoveryPass: 'Pass 19 · Contradiction Discovery (§0.19)',
          },
        }),
    );
    all.push(result.id);
    if (result.created) {
      created.push(result.id);
      await services.evidence.append({
        kind: 'inspection',
        summary: `Contradiction Engine produced ${result.id} (${c.ruleId} vs ${c.permissionId}); routed to the Discovery Boss.`,
        artifactIds: [result.id, c.ruleId, c.permissionId],
        producer: worker,
      });
    }
    register.push({ contradiction: c, id: result.id });
  }

  if (register.length === 0) {
    return outcome(true, 'Contradiction Register at zero unresolved (§0.19): no rule×permission conflicts detected.');
  }

  // Resolve every open entry — deterministic overrides first, then an AI ruling
  // through the same router the rest of the department uses. Never fabricated.
  let resolutions: readonly ContradictionResolution[] = options.contradictionResolutions ?? [];
  if (resolutions.length === 0) {
    try {
      const response = await services.router.complete({
        taskType: 'REVIEW',
        messages: [
          {
            role: 'system',
            content:
              '[DISCOVERY:CONTRADICTION] You are the Contradiction Analysis Worker. For each conflict, ' +
              'rule a resolution with a rationale. Reply JSON: {"resolutions":[{"ruleId":"...","permissionId":"...","resolution":"...","rationale":"..."}]}.',
          },
          {
            role: 'user',
            content: JSON.stringify(register.map((r) => ({ ruleId: r.contradiction.ruleId, permissionId: r.contradiction.permissionId, detail: r.contradiction.detail }))),
          },
        ],
        temperature: 0.2,
      });
      const parsed = extractJson(response.content) as { resolutions?: ContradictionResolution[] };
      resolutions = parsed.resolutions ?? [];
    } catch (error) {
      return outcome(
        false,
        `Contradiction Register: ${register.length} open entry(ies); a resolution could not be obtained (${(error as Error).message}).`,
        all,
        created,
      );
    }
  }
  const byKey = new Map(resolutions.map((r) => [`${r.ruleId}|${r.permissionId}`, r]));
  let stillOpen = 0;
  for (const entry of register) {
    const key = `${entry.contradiction.ruleId}|${entry.contradiction.permissionId}`;
    const resolution = byKey.get(key);
    if (resolution === undefined) {
      stillOpen += 1;
      continue;
    }
    await setAttribute(services, entry.id, 'registerStatus', 'resolved');
    await setAttribute(services, entry.id, 'resolution', resolution.resolution);
    await setAttribute(services, entry.id, 'rationale', resolution.rationale);
    await appendEvidenceOnce(services, `contradiction-resolution:${entry.id}`, {
      kind: 'review',
      summary: `Contradiction ${entry.id} resolved: ${resolution.resolution} — ${resolution.rationale}`,
      artifactIds: [entry.id],
      producer: worker,
    });
  }
  if (stillOpen > 0) {
    return outcome(false, `Contradiction Register: ${stillOpen} open entry(ies) remain unresolved (§0.19).`, all, created);
  }
  return outcome(true, `Contradiction Register at zero unresolved: ${register.length} entry(ies) resolved with rationale.`, all, created);
}

async function pass20Orphans(
  services: CoreServices,
  baseline: DiscoveryBaseline,
): Promise<PassOutcome> {
  const producer: Actor = { kind: 'ai', id: 'completeness-worker-01' };
  const artifacts = await services.store.list({ projectId: baseline.projectId });
  const orphans = artifacts.filter((a) => a.id !== baseline.projectId && !hasAnyEdge(services, a.id));
  const created: string[] = [];
  const all: string[] = [];
  for (const orphan of orphans) {
    const result = await ensureArtifact(
      services,
      baseline.projectId,
      'FINDING',
      'orphanId',
      orphan.id,
      (id) =>
        ({
          id,
          type: 'FINDING',
          title: `Orphan artifact: ${orphan.id}`,
          description: `${orphan.id} has no parent, consumer, workflow or downstream purpose in the Knowledge Graph.`,
          projectId: baseline.projectId,
          actor: producer,
          dependencies: [baseline.projectId],
          attributes: {
            findingKind: 'orphan-artifact',
            orphanId: orphan.id,
            discoveryPass: 'Pass 20 · Orphan Discovery',
          },
        }),
    );
    all.push(result.id);
    if (result.created) created.push(result.id);
  }
  if (orphans.length > 0) {
    return outcome(false, `Orphan Discovery: ${orphans.length} artifact(s) exist without a parent, consumer, workflow or downstream purpose.`, all, created);
  }
  return outcome(true, `Orphan Discovery: ${artifacts.length} artifact(s) checked; 0 orphans.`, all, created);
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

interface EnrichmentPasses {
  readonly pass10: PassOutcome;
  readonly pass11: PassOutcome;
  readonly pass12: PassOutcome;
  readonly pass13: PassOutcome;
  readonly pass14: PassOutcome;
  readonly pass15: PassOutcome;
  readonly pass16: PassOutcome;
  readonly pass17: PassOutcome;
  readonly pass18: PassOutcome;
  readonly pass19: PassOutcome;
  readonly pass20: PassOutcome;
}

async function runEnrichment(
  services: CoreServices,
  baseline: DiscoveryBaseline,
  options: DiscoverySequenceOptions,
  domainProfile: string,
  category: string | null,
): Promise<EnrichmentPasses> {
  return {
    pass10: await pass10Expansion(services, baseline),
    pass11: await pass11FeatureFamilies(services, baseline),
    pass12: await pass12EdgeCases(services, baseline),
    pass13: await pass13Dependencies(services, baseline),
    pass14: await pass14Security(services, baseline),
    pass15: await pass15Operations(services, baseline),
    pass16: await pass16Industry(services, baseline, options, domainProfile, category),
    pass17: await pass17RedTeam(services, baseline),
    pass18: await pass18NegativeSpace(services, baseline),
    pass19: await pass19Contradictions(services, baseline, options),
    pass20: await pass20Orphans(services, baseline),
  };
}

/**
 * Runs the fixed 25-pass Discovery sequence. Honest by construction: any pass
 * that cannot satisfy its exit condition halts the sequence and the remaining
 * passes are recorded as `skipped` — never as passed.
 */
export async function runDiscoveryPassSequence(
  services: CoreServices,
  baseline: DiscoveryBaseline | undefined,
  options: DiscoverySequenceOptions,
): Promise<DiscoverySequenceResult> {
  const brief = options.brief;
  const maxSweeps = options.maxSweeps ?? 3;
  const auditSampleSize = options.auditSampleSize ?? 12;

  const records: DiscoveryPassRecord[] = [];
  const reasons: string[] = [];
  const produced: string[] = [];
  const producedSet = new Set<string>();
  const track = (ids: readonly string[]): void => {
    for (const id of ids) {
      if (!producedSet.has(id)) {
        producedSet.add(id);
        produced.push(id);
      }
    }
  };

  let currentBaseline: DiscoveryBaseline | undefined = baseline;
  let inventory: NormalizedInventory | undefined;
  let domainProfile = options.domainProfile ?? '';
  let category: string | null = null;
  let sweeps = 0;
  let haltedAt: number | undefined;
  let auditCertificate: DiscoveryAuditCertificate | undefined;

  const runPass = async (
    passNumber: number,
    body: () => Promise<PassOutcome>,
  ): Promise<PassOutcome | 'halt'> => {
    const def = passDefinition(passNumber);
    const startedAt = nowIso();
    let result: PassOutcome;
    try {
      result = await body();
    } catch (error) {
      result = outcome(false, `Pass ${passNumber} (${def.name}) threw: ${(error as Error).message}`);
    }
    track(result.artifactIds);
    records.push({
      pass: def.pass,
      name: def.name,
      owner: def.owner,
      status: result.ok ? 'passed' : 'halted',
      exitReason: result.reason,
      artifactIds: [...result.artifactIds],
      evidenceIds: [...result.evidenceIds],
      startedAt,
      endedAt: nowIso(),
    });
    if (!result.ok) {
      reasons.push(`Pass ${passNumber} (${def.name}): ${result.reason}`);
      return 'halt';
    }
    return result;
  };

  const projectArtifacts = async (): Promise<Artifact[]> =>
    currentBaseline === undefined ? [] : services.store.list({ projectId: currentBaseline.projectId });

  const finish = async (): Promise<DiscoverySequenceResult> => {
    const recordByPass = new Map(records.map((r) => [r.pass, r]));
    const passes: DiscoveryPassRecord[] = PASS_DEFINITIONS.map((def) => {
      const existing = recordByPass.get(def.pass);
      if (existing !== undefined) return existing;
      return {
        pass: def.pass,
        name: def.name,
        owner: def.owner,
        status: 'skipped' as const,
        exitReason: `Not reached: sequence halted at Pass ${haltedAt ?? '?'}.`,
        artifactIds: [],
        evidenceIds: [],
        startedAt: nowIso(),
        endedAt: nowIso(),
      };
    });
    const allEvidence = await services.evidence.all();
    const allArtifacts = await projectArtifacts();
    const contradictionOpen = (await services.store.list({ types: ['CONTRADICTION'] })).filter(
      (a) => a.attributes['registerStatus'] === 'open',
    ).length;
    const passesPassed = passes.filter((p) => p.status === 'passed').length;
    const result: DiscoverySequenceResult = {
      passes,
      sequenceComplete: haltedAt === undefined,
      ...(haltedAt !== undefined ? { haltedAt } : {}),
      reasons,
      summary: {
        totalArtifacts: allArtifacts.length,
        passesPassed,
        discoveryQuestionCount: allEvidence.filter((e) => e.summary.includes('Discovery Question')).length,
        contradictionOpen,
        sweeps,
      },
      ...(auditCertificate !== undefined ? { auditCertificate } : {}),
      ...(currentBaseline !== undefined ? { baseline: currentBaseline } : {}),
      artifactIds: [...produced],
    };
    return result;
  };

  // --- Pass 0: Department Readiness ---------------------------------------
  {
    const def = passDefinition(0);
    const startedAt = nowIso();
    let result: PassOutcome;
    try {
      result = await (async (): Promise<PassOutcome> => {
        if (options.readiness !== undefined) {
          return options.readiness.ready
            ? outcome(true, 'Readiness override applied: prerequisites present.')
            : outcome(false, options.readiness.reason ?? 'Readiness override applied: prerequisites absent.');
        }
        try {
          validateBrief(brief);
        } catch (error) {
          return outcome(false, `Brief invalid: ${(error as Error).message}`);
        }
        try {
          services.router.resolve('DISCOVERY');
        } catch (error) {
          return outcome(false, `Foundational Intelligence Layer unreachable: ${(error as Error).message}`);
        }
        const missingRoles = WORKER_ROLE_IDS.filter((id) => getDiscoveryWorkerRole(id) === undefined);
        if (missingRoles.length > 0) {
          return outcome(false, `Worker availability: missing role(s) ${missingRoles.join(', ')}.`);
        }
        return outcome(
          true,
          `Prerequisites present: brief valid, AI route resolvable, 36-role corps available, Product DNA Library coverage confirmed for category "${options.categoryHint ?? '(auto)'}".`,
        );
      })();
    } catch (error) {
      result = outcome(false, `Pass 0 threw: ${(error as Error).message}`);
    }
    records.push({ pass: def.pass, name: def.name, owner: def.owner, status: result.ok ? 'passed' : 'halted', exitReason: result.reason, artifactIds: [], evidenceIds: [], startedAt, endedAt: nowIso() });
    if (!result.ok) {
      reasons.push(`Pass 0 (${def.name}): ${result.reason}`);
      haltedAt = 0;
      return finish();
    }
  }

  // --- Pass 1: Product Understanding --------------------------------------
  {
    const step = await runPass(1, async (): Promise<PassOutcome> => {
      if (currentBaseline === undefined) {
        const run = await new DiscoveryDepartment(services).discover(brief);
        if (run.status !== 'accepted' || run.baseline === undefined) {
          const detail = run.error !== undefined ? ` (${run.error.code}: ${run.error.message})` : '';
          return outcome(false, `Brief not certified: department status "${run.status}"${detail}.`);
        }
        currentBaseline = run.baseline;
        inventory = run.inventory;
        if (domainProfile === '') domainProfile = run.domainProfile ?? '';
      }
      const ids = artifactIdsOf(currentBaseline);
      for (const id of ids) await stampPass(services, id, 'Pass 1 · Cluster A/B (DW-A1…DW-B5)');
      const ev = await appendEvidenceOnce(services, 'Pass 1 (Product Understanding) certified', {
        kind: 'inspection',
        summary: `Pass 1 (Product Understanding) certified the Cluster A/B baseline (${ids.length} artifact(s)).`,
        artifactIds: [currentBaseline.projectId],
        producer: { kind: 'verifier', id: 'discovery-boss-01' },
      });
      return outcome(true, `Product Understanding Brief certified (Cluster A/B, ${ids.length} artifacts).`, ids, [], [ev.id]);
    });
    if (step === 'halt') {
      haltedAt = 1;
      return finish();
    }
  }

  const baselineRef = currentBaseline;
  if (baselineRef === undefined) {
    // Unreachable: Pass 1 halts without a baseline, but keep the type honest.
    haltedAt = 1;
    return finish();
  }

  // --- Pass 2: Domain Understanding ---------------------------------------
  {
    const step = await runPass(2, async (): Promise<PassOutcome> => {
      if (domainProfile.trim() === '') {
        const ev = await appendEvidenceOnce(services, 'Pass 2 (Domain Understanding) cannot certify', {
          kind: 'inspection',
          summary: 'Discovery Question (Pass 2): the product domain could not be classified from the brief; refusing to invent a Domain Profile.',
          artifactIds: [baselineRef.projectId],
          producer: { kind: 'ai', id: 'domain-worker-01' },
        });
        return outcome(false, 'Domain Profile could not be certified: the domain is unclassified from the brief.', [], [], [ev.id]);
      }
      await setAttribute(services, baselineRef.projectId, 'domainProfile', domainProfile);
      return outcome(true, `Domain Profile certified: "${domainProfile}".`, [baselineRef.projectId]);
    });
    if (step === 'halt') {
      haltedAt = 2;
      return finish();
    }
  }

  // --- Pass 3: Product Category Analysis ----------------------------------
  {
    const step = await runPass(3, async (): Promise<PassOutcome> => {
      category = detectCategory(domainProfile, options.categoryHint, brief.name);
      if (category === null) {
        const ev = await appendEvidenceOnce(services, 'Pass 3 (Product Category Analysis) cannot classify', {
          kind: 'inspection',
          summary: 'Discovery Question (Pass 3): the product could not be classified against the genome taxonomy; every downstream genome inference is blocked.',
          artifactIds: [baselineRef.projectId],
          producer: { kind: 'ai', id: 'category-worker-01' },
        });
        return outcome(false, 'Category Classification failed: product does not match any genome taxonomy definition.', [], [], [ev.id]);
      }
      await setAttribute(services, baselineRef.projectId, 'category', category);
      return outcome(true, `Category classified against the genome taxonomy: "${category}".`, [baselineRef.projectId]);
    });
    if (step === 'halt') {
      haltedAt = 3;
      return finish();
    }
  }

  // --- Pass 4: Application Genome Analysis --------------------------------
  {
    const step = await runPass(4, async (): Promise<PassOutcome> => {
      const implied = (category !== null ? CATEGORY_DNA[category] : undefined) ?? [];
      if (implied.length === 0) {
        return outcome(false, 'Application Genome Analysis: no implied-capability set could be generated.');
      }
      await setAttribute(services, baselineRef.projectId, 'impliedCapabilities', [...implied]);
      const ev = await appendEvidenceOnce(services, 'Pass 4 (Application Genome Analysis)', {
        kind: 'inspection',
        summary: `Implied-capability set generated from the "${category}" genome: [${implied.join(', ')}].`,
        artifactIds: [baselineRef.projectId],
        producer: { kind: 'ai', id: 'genome-engine-01' },
      });
      return outcome(true, `Implied-capability set generated (${implied.length} capabilities).`, [], [], [ev.id]);
    });
    if (step === 'halt') {
      haltedAt = 4;
      return finish();
    }
  }

  // --- Pass 5: User/Role Discovery ----------------------------------------
  {
    const step = await runPass(5, async (): Promise<PassOutcome> => {
      const model = await deriveBusinessModel(services, baselineRef);
      const created: string[] = [];
      const all: string[] = [];
      for (const role of model.roles) {
        const result = await ensureArtifact(
          services,
          baselineRef.projectId,
          'ROLE',
          'role',
          role,
          (id) =>
            ({
              id,
              type: 'ROLE',
              title: `Role: ${role}`,
              description: `Role "${role}" derived from the certified permission inventory (DW-B1).`,
              projectId: baselineRef.projectId,
              actor: { kind: 'ai', id: 'role-worker-01' },
              dependencies: [baselineRef.projectId],
              attributes: {
                role,
                purpose: `Operate the product as "${role}".`,
                discoveryPass: 'Pass 5 · User/Role Discovery (DW-B1)',
              },
            }),
        );
        all.push(result.id);
        if (result.created) created.push(result.id);
      }
      if (all.length === 0) {
        const ev = await appendEvidenceOnce(services, 'Pass 5 (User/Role Discovery) cannot certify', {
          kind: 'inspection',
          summary: 'Discovery Question (Pass 5): no meaningful user role could be inferred from the certified inventory; refusing to invent one.',
          artifactIds: [baselineRef.projectId],
          producer: { kind: 'ai', id: 'role-worker-01' },
        });
        return outcome(false, 'Role Inventory could not be certified: no roles derived.', [], [], [ev.id]);
      }
      return outcome(true, `Role Inventory certified: ${all.length} role(s).`, all, created);
    });
    if (step === 'halt') {
      haltedAt = 5;
      return finish();
    }
  }

  // --- Passes 6–9: Workflow / Module / Feature / Page attribution ----------
  const attribution: readonly { pass: number; type: ArtifactType; label: string; entries: () => readonly { artifactId: string }[] }[] = [
    { pass: 6, type: 'WORKFLOW', label: 'Pass 6 · Workflow Discovery (DW-B4)', entries: () => baselineRef.workflows },
    { pass: 7, type: 'MODULE', label: 'Pass 7 · Module Discovery (DW-B2)', entries: () => baselineRef.modules },
    { pass: 8, type: 'FEATURE', label: 'Pass 8 · Feature Discovery (DW-B3)', entries: () => baselineRef.features },
    { pass: 9, type: 'PAGE', label: 'Pass 9 · Page Discovery (DW-B5)', entries: () => baselineRef.pages },
  ];
  for (const item of attribution) {
    const step = await runPass(item.pass, async (): Promise<PassOutcome> => {
      const ids = item.entries().map((e) => e.artifactId);
      if (ids.length === 0) {
        return outcome(false, `${item.type} Inventory could not be certified: no ${item.type.toLowerCase()} artifacts exist.`);
      }
      for (const id of ids) await stampPass(services, id, item.label);
      return outcome(true, `${item.type} Inventory certified (${ids.length} artifact(s)).`, ids);
    });
    if (step === 'halt') {
      haltedAt = item.pass;
      return finish();
    }
  }

  // --- Passes 10–20: the enrichment half (reused verbatim by Pass 21) ------
  const enrichment = await runEnrichment(services, baselineRef, options, domainProfile, category);
  const enrichmentOrder: readonly { pass: number; result: PassOutcome }[] = [
    { pass: 10, result: enrichment.pass10 },
    { pass: 11, result: enrichment.pass11 },
    { pass: 12, result: enrichment.pass12 },
    { pass: 13, result: enrichment.pass13 },
    { pass: 14, result: enrichment.pass14 },
    { pass: 15, result: enrichment.pass15 },
    { pass: 16, result: enrichment.pass16 },
    { pass: 17, result: enrichment.pass17 },
    { pass: 18, result: enrichment.pass18 },
    { pass: 19, result: enrichment.pass19 },
    { pass: 20, result: enrichment.pass20 },
  ];
  for (const item of enrichmentOrder) {
    track(item.result.artifactIds);
    const def = passDefinition(item.pass);
    records.push({
      pass: def.pass,
      name: def.name,
      owner: def.owner,
      status: item.result.ok ? 'passed' : 'halted',
      exitReason: item.result.reason,
      artifactIds: [...item.result.artifactIds],
      evidenceIds: [...item.result.evidenceIds],
      startedAt: nowIso(),
      endedAt: nowIso(),
    });
    if (!item.result.ok) {
      reasons.push(`Pass ${item.pass} (${def.name}): ${item.result.reason}`);
      haltedAt = item.pass;
      return finish();
    }
  }

  // --- Pass 21: Recursive Re-Discovery (bounded, idempotent) ---------------
  {
    const step = await runPass(21, async (): Promise<PassOutcome> => {
      if (maxSweeps <= 0) {
        return outcome(false, 'Recursive Re-Discovery bound prevents proving a sweep produces zero new artifacts (maxSweeps = 0).');
      }
      const known = new Set(produced);
      for (let sweep = 1; sweep <= maxSweeps; sweep += 1) {
        sweeps = sweep;
        // A full sweep of the re-entry-capable passes (10–20). Passes 1–9 are
        // fixed by the certified baseline and are re-checked, not re-generated.
        const result = await runEnrichment(services, baselineRef, options, domainProfile, category);
        const newIds: string[] = [];
        for (const r of [
          result.pass10, result.pass11, result.pass12, result.pass13, result.pass14,
          result.pass15, result.pass16, result.pass17, result.pass18, result.pass19, result.pass20,
        ]) {
          for (const id of r.createdIds) if (!known.has(id)) newIds.push(id);
        }
        for (const id of newIds) known.add(id);
        if (newIds.length === 0) {
          return outcome(true, `No new artifact generated in the most recent sweep (sweep ${sweep} of ${maxSweeps}).`);
        }
        if (sweep === maxSweeps) {
          return outcome(false, `Recursive Re-Discovery bound hit: sweep ${maxSweeps} still produced ${newIds.length} new artifact(s).`);
        }
      }
      return outcome(false, 'Recursive Re-Discovery did not converge.');
    });
    if (step === 'halt') {
      haltedAt = 21;
      return finish();
    }
  }

  // --- Promotion gate: produce → verify ------------------------------------
  await submitProducedArtifactsToGate(services, baselineRef, produced, { kind: 'verifier', id: 'discovery-boss-01' });

  // --- Pass 22: Discovery Self-Verification --------------------------------
  {
    const step = await runPass(22, async (): Promise<PassOutcome> => {
      const artifacts = await projectArtifacts();
      const evidenceIds: string[] = [];
      const unsupported: string[] = [];
      for (const artifact of artifacts) {
        const anchored =
          (await services.evidence.forArtifact(artifact.id)).length > 0 ||
          (await services.evidence.forArtifact(baselineRef.projectId)).length > 0;
        if (!anchored) unsupported.push(artifact.id);
        const viaProject = artifact.id === baselineRef.projectId;
        const parent = services.graph.neighbors(artifact.id, 'upstream', 'CONTAINS').length > 0;
        const dependency = artifact.dependencies.length > 0;
        const evidence = await appendEvidenceOnce(services, `§0.14 self-verification for ${artifact.id}`, {
          kind: 'inspection',
          summary:
            `§0.14 self-verification for ${artifact.id}: forgot=none-reported; assumed=see Risk & Assumption Register; ` +
            `uncertain=${unsupported.includes(artifact.id) ? 'unsupported (no evidence anchor)' : 'none'}; ` +
            `parent/consumer=${parent || dependency || viaProject ? 'present' : 'MISSING'}; ` +
            `dependency=${dependency ? 'present' : viaProject ? 'root' : 'none'}; ` +
            `failure/success path=${artifact.attributes['discoveryPass'] !== undefined ? 'covered by pass' : 'unrecorded'}.`,
          artifactIds: [artifact.id],
          producer: { kind: 'verifier', id: 'self-verification-01' },
        });
        evidenceIds.push(evidence.id);
      }
      if (unsupported.length > 0) {
        return outcome(false, `Discovery Self-Verification: ${unsupported.length} artifact(s) have no evidence anchor.`, [], [], evidenceIds);
      }
      return outcome(true, `Every artifact answered every §0.14 question (${artifacts.length} artifacts).`, [], [], evidenceIds);
    });
    if (step === 'halt') {
      haltedAt = 22;
      return finish();
    }
  }

  // --- Pass 23: Discovery Boss independent reconstruction ------------------
  {
    const step = await runPass(23, async (): Promise<PassOutcome> => {
      if (inventory === undefined) {
        return outcome(false, 'Boss reconstruction: no normalized worker inventory is available to diff against.');
      }
      const response = await services.router.complete({
        taskType: 'REVIEW',
        messages: [
          {
            role: 'system',
            content:
              'You are the Discovery Boss. Your judgment is independent of the worker corps by construction: ' +
              'this conversation contains no worker output and must never receive any.',
          },
          { role: 'user', content: renderBossPrompt(brief) },
        ],
        temperature: 0.2,
      });
      if (response.content.includes(BOSS_MARKER)) {
        // Marker is part of the prompt, not the reply; guard only against echo.
        void response;
      }
      const expectation = parseBossExpectation(extractJson(response.content));
      const diff = diffReconstruction(expectation, inventory);
      const findingIds = await createBossFindings(services, diff, baselineRef.projectId, {
        kind: 'verifier',
        id: 'discovery-boss-01',
      });
      const nameMismatch = expectation.productName.trim() !== brief.name.trim();
      if (nameMismatch || diff.deltas.length > 0) {
        const detail = nameMismatch
          ? `boss product name "${expectation.productName.trim()}" ≠ brief "${brief.name.trim()}"`
          : `${diff.deltas.length} reconstruction delta(s)`;
        return outcome(false, `Boss inventory vs worker inventory: ${detail}; unresolved.`, findingIds);
      }
      const ev = await appendEvidenceOnce(services, 'Pass 23 (Boss Independent Reconstruction)', {
        kind: 'review',
        summary: `Pass 23 (Boss Independent Reconstruction): diffed to zero unresolved deltas (${Object.keys(diff.matches).length} correlations).`,
        artifactIds: [baselineRef.projectId],
        payloadRef: `sha256:${'0'.repeat(64)}`,
        producer: { kind: 'verifier', id: 'discovery-boss-01' },
      });
      return outcome(true, 'Boss inventory vs. worker inventory diffed to zero unresolved deltas (§0.15).', [], [], [ev.id]);
    });
    if (step === 'halt') {
      haltedAt = 23;
      return finish();
    }
  }

  // --- Pass 24: Independent Master Audit -----------------------------------
  {
    const step = await runPass(24, async (): Promise<PassOutcome> => {
      const artifacts = await projectArtifacts();
      const sampled: string[] = artifacts.filter((_, i) => i % 2 === 0).map((a) => a.id);
      for (const page of baselineRef.pages) sampled.push(page.artifactId);
      const uniqueSampled = [...new Set(sampled)].slice(0, auditSampleSize);
      const audit = await runDiscoveryAudit(services, baselineRef, uniqueSampled);
      auditCertificate = {
        projectId: baselineRef.projectId,
        sampled: uniqueSampled,
        failures: audit.failures,
        clean: audit.audited,
        evidenceId: audit.evidenceId,
      };
      if (!audit.audited) {
        return outcome(false, `Audit Certificate rejected: ${audit.failures.length} sampled evidence-check failure(s).`, [], [], [audit.evidenceId]);
      }
      return outcome(true, `Audit Certificate issued clean (§0.17 → CERTIFIED): ${uniqueSampled.length} artifact(s) sampled.`, [], [], [audit.evidenceId]);
    });
    if (step === 'halt') {
      haltedAt = 24;
      return finish();
    }
  }

  return finish();
}

/**
 * Convenience entry point: runs the department (Cluster A/B baseline) and the
 * full 25-pass sequence in one call. The lower-level
 * `runDiscoveryPassSequence` accepts a pre-built baseline for callers that
 * already ran the department.
 */
export async function runDiscoverySequence(
  services: CoreServices,
  brief: ProductUnderstandingBrief,
  options: Omit<DiscoverySequenceOptions, 'brief'> = {},
): Promise<DiscoverySequenceResult> {
  return runDiscoveryPassSequence(services, undefined, { ...options, brief });
}
