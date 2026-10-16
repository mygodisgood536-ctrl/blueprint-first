import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeServices } from './helpers/test-services.ts';
import { ProjectRegistry } from '../src/project/registry.ts';
import { ProjectExecution } from '../src/project/execution.ts';
import { StageStateStore } from '../src/project/stage-state.ts';
import type { ProjectMode } from '../src/project/types.ts';

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
  return { dir, services, stages, registry, project, execution, actor };
}

test('full-product lifecycle executes every stage with the real engines', async () => {
  const { dir, services, project, execution, actor } = await setup('full-product');
  try {
    for (const stageId of FULL_CHAIN) {
      const r = await execution.runStage({ project, stageId, services, actor });
      assert.equal(r.record.status, 'completed', `${stageId} should complete: ${r.record.error?.message ?? ''}`);
    }
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
