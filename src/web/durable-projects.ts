/**
 * Durable project store for the Nexona product layer.
 *
 * The engineering-core demo pipeline (runDemoPipeline) deliberately REBUILDS
 * its artifact store from scratch on every server start (it resets its own
 * `blueprint-store.json` for a deterministic showcase). Web-created projects
 * therefore live only for the lifetime of one process unless the web layer
 * keeps its own snapshot and replays it into the freshly-built store.
 *
 * This module is that snapshot: it persists every PROJECT artifact created or
 * updated through the web API to a JSON file (atomic writes) and replays them
 * into the current store at boot. Replay is idempotent (an artifact already
 * present is skipped), re-registers the project id with the id allocator so
 * new ids never collide, and re-adds the graph node so dependency-map and
 * lineage views still resolve the project.
 *
 * Ownership/scope/delete state all live on the artifact attributes, so the
 * snapshot round-trips them exactly — the existing server routes keep acting
 * on `result.registry` unchanged.
 */

import { join } from 'node:path';
import type { Artifact } from '../core/artifact.ts';
import type { ArtifactStore } from '../core/store.ts';
import type { KnowledgeGraph } from '../core/graph.ts';
import type { ArtifactIdAllocator } from '../core/id-allocator.ts';
import { JsonFileStore } from './durable.ts';

const SCHEMA_VERSION = 1;

interface ProjectSnapshot {
  projects: Artifact[];
}

/** Default web-project snapshot path for a given data directory. */
export function webProjectsFilePath(dataDir: string): string {
  return join(dataDir, 'web-projects.json');
}

export class DurableProjectStore {
  private readonly file: JsonFileStore<ProjectSnapshot>;
  private readonly byId = new Map<string, Artifact>();
  private loaded = false;

  constructor(options: { filePath: string }) {
    this.file = new JsonFileStore<ProjectSnapshot>({
      filePath: options.filePath,
      schemaVersion: SCHEMA_VERSION,
    });
  }

  /** Loads persisted projects. Safe to call repeatedly. */
  async init(): Promise<void> {
    if (this.loaded) return;
    const snapshot = await this.file.load();
    if (snapshot !== null) {
      for (const project of snapshot.projects) {
        if (typeof project?.id === 'string') this.byId.set(project.id, project);
      }
    }
    this.loaded = true;
  }

  /** True when the durable store is tracking the given project. */
  has(id: string): boolean {
    return this.byId.has(id);
  }

  /**
   * Captures the latest state of a web-owned project artifact. Called after
   * every web-layer mutation (create/update/stage-run/approve/delete) so the
   * snapshot always matches the artifact the API just returned.
   */
  async capture(artifact: Artifact): Promise<void> {
    this.byId.set(artifact.id, artifact);
    await this.persist();
  }

  /**
   * Replays persisted projects into the current store. Idempotent: artifacts
   * already present in the store are left untouched. Returns the number of
   * projects replayed.
   */
  async replayInto(
    store: ArtifactStore,
    graph: KnowledgeGraph,
    allocator: ArtifactIdAllocator,
  ): Promise<number> {
    let replayed = 0;
    for (const artifact of this.byId.values()) {
      allocator.observe(artifact.id);
      if ((await store.get(artifact.id)) !== null) continue;
      await store.append(artifact);
      graph.addNode(artifact.id);
      replayed += 1;
    }
    return replayed;
  }

  /** Removes a project from the snapshot (used when it is hard-purged). */
  async remove(id: string): Promise<void> {
    if (this.byId.delete(id)) await this.persist();
  }

  /** Persists the full project snapshot atomically. */
  async persist(): Promise<void> {
    const projects = [...this.byId.values()];
    await this.file.save({ projects });
  }
}