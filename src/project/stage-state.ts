/**
 * Per-project lifecycle stage state (D5).
 *
 * The boot-time demo pipeline used to back every stage API with one hardcoded
 * full-product run. Real execution is per project: each lifecycle stage is run
 * on demand, against the project's own artifacts, and its outcome is persisted
 * here so stage reads survive restarts without re-running any engine.
 *
 * This store is deliberately separate from the PROJECT artifact's `stages`
 * attribute: a stage record carries the real, potentially large result payload
 * (artifact ids, evidence ids, typed summaries, gate reasons), while the
 * artifact stays lean. The artifact's `stages` attribute remains the
 * human-readable breadcrumb; this file is the structured source of truth.
 */

import { join } from 'node:path';
import { JsonFileStore } from '../web/durable.ts';

const SCHEMA_VERSION = 1;

/** Lifecycle status of a single stage run. */
export type StageStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'not-in-scope';

/** A single stage's persisted outcome for one project. */
export interface StageRecord {
  readonly stageId: string;
  readonly status: StageStatus;
  readonly startedAt?: string;
  readonly endedAt?: string;
  /** Artifacts produced or advanced by this stage (project-scoped). */
  readonly artifactIds: readonly string[];
  /** Evidence records appended by this stage. */
  readonly evidenceIds: readonly string[];
  /** Typed, stage-specific summary for the read APIs (real values only). */
  readonly summary: Readonly<Record<string, unknown>>;
  /** Present iff status === 'failed': the honest reason the stage did not pass. */
  readonly error?: { readonly message: string; readonly code?: string };
}

/** All stage records for one project. */
export interface ProjectStageState {
  readonly projectId: string;
  readonly stages: Readonly<Record<string, StageRecord>>;
  readonly updatedAt: string;
}

interface StageStateFile {
  projects: ProjectStageState[];
}

/** Default path for a project's stage-state file. */
export function projectStageStatePath(dataDir: string, projectId: string): string {
  return join(dataDir, 'stage-state.json');
}

const emptyRecord = (stageId: string): StageRecord => ({
  stageId,
  status: 'pending',
  artifactIds: [],
  evidenceIds: [],
  summary: {},
});

/**
 * Durable, concurrency-safe stage-state store keyed by project id. The whole
 * file is small (one entry per project) so it is loaded once and rewritten on
 * each mutation; writes are serialized through a promise chain to avoid lost
 * updates when two stages of different projects run concurrently.
 */
export class StageStateStore {
  private readonly file: JsonFileStore<StageStateFile>;
  private readonly byProject = new Map<string, ProjectStageState>();
  private loaded = false;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(options: { filePath: string }) {
    this.file = new JsonFileStore<StageStateFile>({
      filePath: options.filePath,
      schemaVersion: SCHEMA_VERSION,
    });
  }

  async init(): Promise<void> {
    if (this.loaded) return;
    const snapshot = await this.file.load();
    if (snapshot !== null) {
      for (const state of snapshot.projects) {
        if (typeof state?.projectId === 'string') {
          this.byProject.set(state.projectId, state);
        }
      }
    }
    this.loaded = true;
  }

  /** The full stage state for a project (empty stages when never run). */
  get(projectId: string): ProjectStageState {
    return (
      this.byProject.get(projectId) ?? {
        projectId,
        stages: {},
        updatedAt: new Date(0).toISOString(),
      }
    );
  }

  /** A single stage record, defaulting to a pending record. */
  getStage(projectId: string, stageId: string): StageRecord {
    return this.get(projectId).stages[stageId] ?? emptyRecord(stageId);
  }

  /**
   * Applies a mutation to a project's stage state and persists it. The mutation
   * returns the next stage record (or the prior state is kept when it returns
   * the same reference). Serialized: concurrent calls cannot interleave a
   * read-modify-write.
   */
  async record(
    projectId: string,
    mutate: (state: ProjectStageState) => ProjectStageState,
  ): Promise<ProjectStageState> {
    let result!: ProjectStageState;
    const run = async (): Promise<void> => {
      const current = this.get(projectId);
      const next = mutate(current);
      const stamped: ProjectStageState = { ...next, projectId, updatedAt: new Date().toISOString() };
      this.byProject.set(projectId, stamped);
      result = stamped;
      await this.persistNow();
    };
    this.writeChain = this.writeChain.then(run, run);
    await this.writeChain;
    return result;
  }

  /** Convenience: set (replace) one stage record. */
  async setStage(projectId: string, record: StageRecord): Promise<ProjectStageState> {
    return this.record(projectId, (state) => ({
      ...state,
      stages: { ...state.stages, [record.stageId]: record },
    }));
  }

  private async persistNow(): Promise<void> {
    await this.file.save({ projects: [...this.byProject.values()] });
  }
}
