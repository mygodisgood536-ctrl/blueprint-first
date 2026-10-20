import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeServices } from './helpers/test-services.ts';
import { ProjectRegistry } from '../src/project/registry.ts';
import { ProjectExecution } from '../src/project/execution.ts';
import { StageStateStore } from '../src/project/stage-state.ts';
import { LocalWorkspaceEnvAdapter } from '../src/env/local-workspace.ts';
import type { ProjectMode } from '../src/project/types.ts';
import type { Artifact } from '../src/core/artifact.ts';

const FULL_CHAIN = [
  'discovery',
  'design',
  'design-verification',
  'blueprint',
  'architecture',
  'implementation',
  'testing',
  'verification',
  'deployment',
  'operations',
  'maintenance',
  'continuous-improvement',
] as const;

/**
 * A REAL execution environment holding REAL source files.
 *
 * The Build stage derives its -IMPL artifacts by reading this workspace back
 * through the EnvAdapter port, so the lifecycle test runs against real files on
 * a real filesystem rather than a stubbed adapter that would prove nothing.
 */
async function realEnvironment(root: string): Promise<LocalWorkspaceEnvAdapter & { environmentId: string }> {
  await mkdir(join(root, 'src', 'app', 'dashboard'), { recursive: true });
  await mkdir(join(root, 'src', 'lib'), { recursive: true });
  await writeFile(join(root, 'src', 'app', 'dashboard', 'page.tsx'), 'export default function Dashboard() { return null; }\n', 'utf8');
  await writeFile(join(root, 'src', 'lib', 'tasks.ts'), 'export const tasks: string[] = [];\n', 'utf8');
  const adapter = new LocalWorkspaceEnvAdapter(root);
  await adapter.provision({ label: 'lifecycle', gitEnabled: true });
  return Object.assign(adapter, { environmentId: 'ENV-LIFECYCLE' });
}

async function setup(mode: ProjectMode = 'full-product') {
  const dir = await mkdtemp(join(tmpdir(), 'bf-exec-'));
  const services = makeServices();
  const stages = new StageStateStore({ filePath: join(dir, 'stage-state.json') });
  await stages.init();
  const registry = new ProjectRegistry(services);
  const project = await registry.createProject({
    title: 'TeamTask',
    description: 'A lightweight task tracker that small teams can adopt in minutes.',
    mode,
    owner: { userId: 'tester' },
    actor: { kind: 'human', id: 'tester' },
    scope: ['TeamTask'],
  });
  const execution = new ProjectExecution({ services, stages });
  const actor = { kind: 'human' as const, id: 'tester' };
  const workspaceRoot = join(dir, 'workspace');
  const executionEnvironment = await realEnvironment(workspaceRoot);
  return { dir, services, stages, registry, project, execution, actor, executionEnvironment, workspaceRoot };
}

/**
 * Runs the stages that precede Build, then writes REAL source files for every
 * certified page route into the real workspace.
 *
 * This is what an actual build does: the certified Design baseline says which
 * routes exist, and the build writes the files that serve them. The lifecycle
 * test therefore materializes real code rather than letting the build stage
 * certify designs that nothing on disk implements.
 */
async function runUpToBlueprint(
  services: ReturnType<typeof makeServices>,
  stages: StageStateStore,
  project: Artifact,
  execution: ProjectExecution,
  actor: { kind: 'human'; id: string },
  executionEnvironment: LocalWorkspaceEnvAdapter & { environmentId: string },
  workspaceRoot: string,
): Promise<void> {
  for (const stageId of ['discovery', 'design', 'design-verification', 'blueprint'] as const) {
    const r = await execution.runStage({ project, stageId, services, actor, executionEnvironment });
    assert.equal(r.record.status, 'completed', `${stageId} should complete: ${r.record.error?.message ?? ''}`);
  }
  const design = stages.getStage(project.id, 'design').summary;
  const blueprintId = design['blueprintId'];
  assert.equal(typeof blueprintId, 'string');
  const blueprint = await services.store.require(blueprintId as string);
  const pageDesignIds = (blueprint.attributes['pageDesignIds'] as readonly string[] | undefined) ?? [];
  const featureDesignIds = (blueprint.attributes['featureDesignIds'] as readonly string[] | undefined) ?? [];

  let written = 0;
  for (const designId of pageDesignIds) {
    const artifact = await services.store.require(designId);
    const doc = artifact.attributes['designDoc'] as { navigation?: { route?: string } } | undefined;
    const route = doc?.navigation?.route;
    if (typeof route !== 'string' || route === '') continue;
    const slug = route.replace(/^.*\//, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'home';
    const dir = join(workspaceRoot, 'src', 'app', slug);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'page.tsx'),
      `export default function ${slug}() { return null; }\n`,
      'utf8',
    );
    written += 1;
  }
  for (const featureDesignId of featureDesignIds) {
    const artifact = await services.store.require(featureDesignId);
    // The build writes a real module named after the feature it implements, so
    // the feature's -IMPL can be bound to a real file on disk.
    const baseId = featureDesignId.replace(/-DESIGN$/, '');
    const slug = artifact.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
    const dir = join(workspaceRoot, 'src', 'features', slug || baseId.toLowerCase());
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, `${baseId.toLowerCase()}.ts`),
      `export const ${baseId.replace(/[^A-Za-z0-9]/g, '')} = { implemented: true };\n`,
      'utf8',
    );
    written += 1;
  }
  assert.ok(written > 0, 'the certified design must produce at least one real route to build');
}

test('full-product lifecycle executes every stage with the real engines', async () => {
  const { dir, services, stages, project, execution, actor, executionEnvironment, workspaceRoot } = await setup('full-product');
  try {
    await runUpToBlueprint(services, stages, project, execution, actor, executionEnvironment, workspaceRoot);
    for (const stageId of FULL_CHAIN.slice(4)) {
      const r = await execution.runStage({ project, stageId, services, actor, executionEnvironment });
      assert.equal(r.record.status, 'completed', `${stageId} should complete: ${r.record.error?.message ?? ''}`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the build stage records the real files it read back from the environment', async () => {
  const { dir, services, stages, project, execution, actor, executionEnvironment, workspaceRoot } = await setup('full-product');
  try {
    await runUpToBlueprint(services, stages, project, execution, actor, executionEnvironment, workspaceRoot);
    const r = await execution.runStage({ project, stageId: 'architecture', services, actor, executionEnvironment });
    assert.equal(r.record.status, 'completed', r.record.error?.message ?? '');

    const architecture = stages.getStage(project.id, 'architecture');
    const fileCount = Number(architecture.summary['realFileCount']);
    assert.ok(fileCount > 0, 'the build stage must record the real files it observed');
    assert.equal(architecture.summary['realEnvironmentId'], 'ENV-LIFECYCLE');
    assert.match(String(architecture.summary['realInventoryHash']), /^[0-9a-f]{64}$/);
    // Every certified route that was built must now have a real -IMPL artifact.
    const pageImplIds = architecture.summary['realPageImplIds'] as readonly string[];
    assert.ok(pageImplIds.length > 0, 'at least one page -IMPL must be derived from a real file');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the build stage refuses to fabricate an implementation with no real environment', async () => {
  const { dir, services, project, execution, actor } = await setup('full-product');
  try {
    for (const stageId of ['discovery', 'design', 'design-verification', 'blueprint'] as const) {
      const r = await execution.runStage({ project, stageId, services, actor });
      assert.equal(r.record.status, 'completed', `${stageId} should complete: ${r.record.error?.message ?? ''}`);
    }
    const r = await execution.runStage({ project, stageId: 'architecture', services, actor });
    assert.equal(r.record.status, 'failed');
    assert.match(String(r.record.error?.message ?? ''), /READY execution environment/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the build stage refuses when the real environment contains no source at all', async () => {
  const { dir, services, stages, project, execution, actor, workspaceRoot } = await setup('full-product');
  try {
    await runUpToBlueprint(services, stages, project, execution, actor, await realEnvironment(join(dir, 'scratch')), workspaceRoot);
    // A READY environment that genuinely holds no product source.
    const emptyEnv = await realEnvironment(join(dir, 'empty-workspace'));
    await rm(join(dir, 'empty-workspace', 'src'), { recursive: true, force: true });
    const r = await execution.runStage({ project, stageId: 'architecture', services, actor, executionEnvironment: emptyEnv });
    assert.equal(r.record.status, 'failed');
    assert.match(String(r.record.error?.message ?? ''), /no readable source files/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('discovery artifacts are scoped to the EXISTING project (no second project is created)', async () => {
  const { dir, services, project, execution, actor } = await setup('design-only');
  try {
    const r = await execution.runStage({ project, stageId: 'discovery', services, actor });
    assert.equal(r.record.status, 'completed');
    assert.equal(r.record.summary['projectId'], project.id);
    assert.ok(r.record.artifactIds.length > 0);
    let projectArtifacts = 0;
    for (const artifactId of r.record.artifactIds) {
      const artifact = await services.store.require(artifactId);
      if (artifact.type === 'PROJECT') {
        projectArtifacts += 1;
        assert.equal(artifact.id, project.id, 'the reused project artifact is the existing project');
      } else {
        assert.equal(artifact.projectId, project.id, `${artifactId} belongs to the project`);
      }
    }
    assert.equal(projectArtifacts, 1, 'exactly one (reused) project artifact');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('out-of-scope stages are rejected, never falsely run', async () => {
  const { dir, services, project, execution, actor } = await setup('design-only');
  try {
    await assert.rejects(
      () => execution.runStage({ project, stageId: 'deployment', services, actor }),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        (error as { code: string }).code === 'STAGE_OUT_OF_SCOPE',
    );
    assert.equal(execution['stages'].getStage(project.id, 'deployment').status, 'pending');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a stage whose prerequisite is missing halts honestly (nothing fabricated)', async () => {
  const { dir, services, project, execution, actor } = await setup('design-plus-code');
  try {
    const r = await execution.runStage({ project, stageId: 'design', services, actor });
    assert.equal(r.record.status, 'failed');
    assert.equal(r.record.error?.code, 'DISCOVERY_MISSING');
    assert.equal(r.record.artifactIds.length, 0);
    assert.equal(execution['stages'].getStage(project.id, 'design').status, 'failed');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('design-only mode completes its in-scope terminal stage', async () => {
  const { dir, services, project, execution, actor } = await setup('design-only');
  try {
    for (const stageId of ['discovery', 'design', 'design-verification']) {
      const r = await execution.runStage({ project, stageId, services, actor });
      assert.equal(r.record.status, 'completed', `${stageId}: ${r.record.error?.message ?? ''}`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
