/** Shared test harness: builds CoreServices wired to deterministic providers. */

import { MemoryArtifactStore } from '../../src/core/memory-store.ts';
import { ArtifactIdAllocator } from '../../src/core/id-allocator.ts';
import { KnowledgeGraph } from '../../src/core/graph.ts';
import { MemoryEvidenceLog } from '../../src/verification/evidence.ts';
import { AiRouter } from '../../src/ai/router.ts';
import { ScriptedProvider } from '../../src/ai/scripted-provider.ts';
import type { CoreServices } from '../../src/core/services.ts';

export const SAMPLE_DISCOVERY_JSON = {
  product: {
    name: 'TeamTask',
    summary: 'A lightweight task tracker for small teams.',
  },
  modules: [
    { key: 'projects', title: 'Projects', purpose: 'Organize tasks into projects.' },
    { key: 'tasks', title: 'Tasks', purpose: 'Create and track work items.' },
  ],
  features: [
    { key: 'project-organizer', moduleKey: 'projects', title: 'Project organizer', description: 'Group and filter tasks by project.' },
    { key: 'task-crud', moduleKey: 'tasks', title: 'Task CRUD', description: 'Create, update and complete tasks.' },
  ],
  workflows: [
    { key: 'task-lifecycle', title: 'Task lifecycle', steps: ['create', 'assign', 'complete'] },
  ],
  pages: [
    {
      key: 'task-board',
      moduleKey: 'tasks',
      title: 'Task Board',
      purpose: 'See all tasks at a glance.',
      sections: [
        { key: 'board-columns', title: 'Columns', contentType: 'kanban' },
        { key: 'board-toolbar', title: 'Toolbar', contentType: 'toolbar' },
      ],
      actions: [
        { key: 'create-task', title: 'Create task', outcome: 'New task appears in first column.' },
        { key: 'move-task', title: 'Move task', outcome: 'Task changes column.' },
      ],
      states: [
        { key: 'empty-board', name: 'Empty board', whenVisible: 'No tasks exist yet.' },
        { key: 'task-overdue', name: 'Overdue highlight', whenVisible: 'Due date passed.' },
      ],
      validations: [
        { targetKey: 'create-task', message: 'Title is required.' },
      ],
    },
    {
      key: 'task-details',
      moduleKey: 'tasks',
      title: 'Task Details',
      purpose: 'Edit a single task.',
      sections: [{ key: 'details-form', title: 'Details form', contentType: 'form' }],
      actions: [
        { key: 'save-changes', title: 'Save changes', outcome: 'Task persisted.' },
        { key: 'delete-task', title: 'Delete task', outcome: 'Task removed after confirm.' },
      ],
      states: [{ key: 'unsaved-changes', name: 'Unsaved changes', whenVisible: 'Form differs from stored task.' }],
      validations: [{ targetKey: 'save-changes', message: 'At least one field must change.' }],
    },
  ],
  rules: [{ key: 'confirm-before-delete', statement: 'Deleting a task always requires confirmation.' }],
  permissions: [{ key: 'manage-tasks', resource: 'task', roles: ['admin', 'member'] }],
  entities: [
    {
      key: 'task',
      name: 'Task',
      fields: [
        { name: 'title', type: 'string', required: true },
        { name: 'dueDate', type: 'date', required: false },
        { name: 'points', type: 'number', required: false },
      ],
    },
  ],
  apis: [
    { key: 'create-task-api', method: 'POST', path: '/api/tasks', purpose: 'Create a task.', requestEntityKey: 'task', responseEntityKey: 'task' },
    { key: 'list-tasks-api', method: 'GET', path: '/api/tasks', purpose: 'List tasks.', responseEntityKey: 'task' },
  ],
  integrations: [
    { key: 'email-notify', name: 'Email notifications', direction: 'outbound', purpose: 'Notify assignees.' },
  ],
} as const;

export function discoveryResponse(): string {
  return JSON.stringify(SAMPLE_DISCOVERY_JSON);
}

/** Deterministic DESIGN-task response: labeled commentary, never structure. */
export function designRationale(): string {
  return (
    'Scripted design rationale (deterministic): layout preserves the certified ' +
    'section order; every interaction maps one-to-one to a discovered action and ' +
    'carries its validations; states are honored verbatim from the baseline.'
  );
}

/** Deterministic BUILD-task response: implementation notes, never structure. */
export function buildImplementationNote(): string {
  return (
    'Scripted implementation note (deterministic): component skeleton derives ' +
    'from the approved design doc; actions bind to discovered outcomes; ' +
    'validation messages surface inline next to their triggers.'
  );
}

// --- Level 1b Discovery Department scripted responses -----------------------

export function departmentUnderstandingResponse(): string {
  return JSON.stringify({
    product: {
      name: SAMPLE_DISCOVERY_JSON.product.name,
      summary: SAMPLE_DISCOVERY_JSON.product.summary,
    },
    domainProfile: 'Lightweight team-productivity domain; small collaborative teams.',
    selfCheck: { uncertainties: ['Whether recurring tasks are in scope.'] },
  });
}

export function departmentStructuralResponse(): string {
  const rest = JSON.parse(JSON.stringify(SAMPLE_DISCOVERY_JSON)) as Record<string, unknown>;
  delete rest['product'];
  return JSON.stringify({ ...rest, selfCheck: { uncertainties: [] } });
}

/** The boss's default expectation aligns exactly with the sample inventory. */
export function departmentBossResponse(): string {
  return JSON.stringify({
    productName: SAMPLE_DISCOVERY_JSON.product.name,
    features: SAMPLE_DISCOVERY_JSON.features.map((f) => ({ key: f.key, title: f.title })),
    workflows: SAMPLE_DISCOVERY_JSON.workflows.map((w) => ({ key: w.key, title: w.title })),
    pages: SAMPLE_DISCOVERY_JSON.pages.map((p) => ({ key: p.key, title: p.title })),
  });
}

export interface ServicesOptions {
  discoveryResponse?: () => string;
  designResponse?: () => string;
  buildResponse?: () => string;
  /** Level-1b department overrides (routed by prompt markers). */
  departmentResponses?: {
    understanding?: () => string;
    structural?: () => string;
    boss?: () => string;
  };
}

export function makeServices(options: ServicesOptions = {}): CoreServices & {
  router: AiRouter;
  scripted: ScriptedProvider;
} {
  const department = options.departmentResponses ?? {};
  const scripted = new ScriptedProvider({
    rules: [
      // Department rules MUST precede the generic DISCOVERY rule: cluster and
      // boss calls also carry taskType DISCOVERY/REVIEW but are routed by
      // their prompt markers.
      {
        match: (req) =>
          req.messages.some((m) => m.content.includes('[DISCOVERY:CLUSTER-A]')),
        respond: department.understanding ?? departmentUnderstandingResponse,
      },
      {
        match: (req) =>
          req.messages.some((m) => m.content.includes('[DISCOVERY:CLUSTER-B]')),
        respond: department.structural ?? departmentStructuralResponse,
      },
      {
        match: (req) => req.messages.some((m) => m.content.includes('[DISCOVERY:BOSS-RECONSTRUCTION]')),
        respond: department.boss ?? departmentBossResponse,
      },
      {
        match: (req) => req.taskType === 'DISCOVERY',
        respond: options.discoveryResponse ?? discoveryResponse,
      },
      {
        match: (req) => req.taskType === 'DESIGN',
        respond: options.designResponse ?? designRationale,
      },
      {
        match: (req) => req.taskType === 'BUILD',
        respond: options.buildResponse ?? buildImplementationNote,
      },
    ],
  });
  const router = new AiRouter();
  router.register(scripted).setDefaultProvider('scripted');
  return {
    store: new MemoryArtifactStore(),
    allocator: new ArtifactIdAllocator(),
    graph: new KnowledgeGraph(),
    evidence: new MemoryEvidenceLog(),
    router,
    scripted,
  };
}

/**
 * Runs single-pass discovery against the sample inventory and asserts the
 * baseline was accepted, returning the wired services for follow-on stages.
 */
export async function discoverSample(
  brief: { name: string; vision: string; targetUsers: string[] },
  options: ServicesOptions = {},
): Promise<{ services: ReturnType<typeof makeServices>; baseline: import('../../src/discovery/materialize.ts').DiscoveryBaseline }> {
  const { SinglePassDiscoveryEngine } = await import('../../src/discovery/engine.ts');
  const services = makeServices(options);
  const result = await new SinglePassDiscoveryEngine(services).discover(brief);
  if (result.status !== 'accepted' || result.baseline === undefined) {
    throw new Error(`Fixture discovery run did not succeed: ${result.status}`);
  }
  return { services, baseline: result.baseline };
}
