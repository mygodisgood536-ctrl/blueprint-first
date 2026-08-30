/**
 * ProjectRegistry - structured project identity, mode, and lifecycle scoping.
 *
 * A project is an ordinary artifact of type PROJECT (see core/ids.ts). It is
 * created through the SAME allocator, store, graph, and provenance channels as
 * every other artifact - there is no second ID system, no second persistence
 * system, and no second graph. The registry is the deliberate, typed surface
 * over that artifact representation.
 *
 * The selected ProjectMode is real structured state stored on the PROJECT
 * artifact's attributes. It does NOT create a second state machine: the
 * existing Definition-of-Complete (doc.ts) machine remains authoritative.
 * Mode instead declares the legitimate SCOPE of the lifecycle for that project
 * - which stages are IN scope and the stage at which the project is "complete
 * within scope". Out-of-scope stages are reported honestly as such, never
 * falsely completed.
 *
 * Registry operations here are additive only (create/read + link); changing a
 * mode is an explicit act for a later increment and is intentionally not
 * exposed here.
 */

import { createArtifact } from '../core/artifact.ts';
import type { Actor, Artifact } from '../core/artifact.ts';
import { syncArtifactToGraph } from '../core/graph.ts';
import type { CoreServices } from '../core/services.ts';
import {
  PROJECT_MODE_STAGES,
  PROJECT_MODE_LIFECYCLE_COMPLETE,
} from './types.ts';
import type { ProjectMode } from './types.ts';
import type { AppConfig } from '../core/config.ts';
import type { ProviderPreference, ProjectConfiguration } from './config.ts';
import {
  defaultProjectConfiguration,
  normalizeProjectConfiguration,
} from './config.ts';
import type { AiTaskType } from '../ai/types.ts';

/** Owner of a project; today a named user (the account layer comes later). */
export interface ProjectOwner {
  readonly userId: string;
  readonly label?: string;
}

/** Structured, validated creation input for a project. */
export interface CreateProjectInput {
  readonly title: string;
  readonly description?: string;
  readonly mode: ProjectMode;
  readonly owner: ProjectOwner;
  readonly actor: Actor;
  readonly scope?: readonly string[];
  /** Project configuration; per-provider/model settings land in later increments. */
  readonly config?: Readonly<Record<string, unknown>>;
  readonly at?: string;
}

/** The project's structured configuration, stored in attributes. */
export interface ProjectConfig {
  readonly mode: ProjectMode;
  readonly owner: ProjectOwner;
  readonly scope: readonly string[];
  readonly config: Readonly<Record<string, unknown>>;
}

function assertMode(mode: string): asserts mode is ProjectMode {
  if (!(mode in PROJECT_MODE_LIFECYCLE_COMPLETE)) {
    throw new Error(
      `Unknown project mode "${mode}". Known modes: ${Object.keys(PROJECT_MODE_LIFECYCLE_COMPLETE).join(', ')}.`,
    );
  }
}

/** True when the given lifecycle stage is within a project mode's scope. */
export function stageInScope(mode: ProjectMode, stageId: string): boolean {
  const stages = PROJECT_MODE_STAGES[mode];
  const match = stages.find((s) => s.stageId === stageId);
  return match?.inScope ?? false;
}

export class ProjectRegistry {
  private readonly services: CoreServices;

  constructor(services: CoreServices) {
    this.services = services;
  }

  /**
   * Creates a PROJECT artifact through the existing allocator/store/graph and
   * records the given mode as structured attributes. The project is created in
   * the existing legal DRAFT state - the Project Registry is an orchestration /
   * context layer around the artifact system, NOT a replacement for the DoC
   * state machine. Ownership/configuration is confirmed via confirmProject,
   * which validates but does not invent any DoC transition.
   */
  async createProject(input: CreateProjectInput): Promise<Artifact> {
    const title = input.title.trim();
    if (title.length === 0) {
      throw new Error('Project title must be a non-empty string.');
    }
    assertMode(input.mode);
    if (input.owner.userId.trim().length === 0) {
      throw new Error('Project owner.userId must be a non-empty string.');
    }

    const id = this.services.allocator.nextId('PROJECT');
    const artifact = createArtifact({
      id,
      type: 'PROJECT',
      title,
      description: input.description?.trim() ?? '',
      actor: input.actor,
      at: input.at,
      tags: ['project'],
      attributes: {
        mode: input.mode,
        projectConfig: { ...(input.config ?? {}) },
        owner: { userId: input.owner.userId, ...(input.owner.label !== undefined ? { label: input.owner.label } : {}) },
        scope: [...(input.scope ?? [])].sort(),
        lifecycleComplete: PROJECT_MODE_LIFECYCLE_COMPLETE[input.mode],
      },
    });
    await this.services.store.append(artifact);
    syncArtifactToGraph(this.services.graph, artifact);

    await this.services.evidence.append({
      kind: 'inspection',
      summary: `Project ${id} created (mode=${input.mode}, owner=${input.owner.userId}).`,
      artifactIds: [id],
      producer: { kind: 'system', id: 'project-registry' },
    });
    return artifact;
  }

  /**
   * Adopts an EXISTING PROJECT artifact into the registry by decorating it
   * with structured mode/scope/config attributes. Used when a PROJECT artifact
   * already exists (for example, discovery materializes one) and the mode-aware
   * registry should own its scoping metadata rather than creating a duplicate
   * PROJECT artifact. Idempotent: decorating an already-adopted project is a
   * no-op only if the mode matches; otherwise it is refused with an error.
   */
  async adoptProject(input: CreateProjectInput & { projectId: string }): Promise<Artifact> {
    const existing = await this.requireProject(input.projectId);
    assertMode(input.mode);
    const existingMode = existing.attributes['mode'];
    if (existingMode !== undefined) {
      if (existingMode !== input.mode) {
        throw new Error(
          `Project ${input.projectId} already has mode "${String(existingMode)}"; refusing to override with "${input.mode}".`,
        );
      }
      return existing; // already adopted with the same mode
    }
    const updated = await this.services.store.update(
      input.projectId,
      existing.version,
      (draft) => ({
        ...draft,
        attributes: {
          ...draft.attributes,
          mode: input.mode,
          projectConfig: { ...(input.config ?? {}) },
          owner: { userId: input.owner.userId, ...(input.owner.label !== undefined ? { label: input.owner.label } : {}) },
          scope: [...(input.scope ?? [])].sort(),
          lifecycleComplete: PROJECT_MODE_LIFECYCLE_COMPLETE[input.mode],
        },
        tags: Array.from(new Set([...(draft.tags ?? []), 'project'])),
      }),
    );
    await this.services.evidence.append({
      kind: 'inspection',
      summary: `Project ${input.projectId} adopted with mode ${input.mode}.`,
      artifactIds: [input.projectId],
      producer: { kind: 'system', id: 'project-registry' },
    });
    return updated;
  }

  /**
   * Confirm project ownership/configuration/identity state. This validates the
   * project is well-formed (owner present, mode present, lifecycle-complete
   * stage derivable) and records that confirmation as evidence. It does NOT
   * perform a DoC status transition: the existing DoC state machine remains
   * exclusively authoritative for the Blueprint engineering lifecycle, and the
   * project is confirmed while staying in its legal DRAFT state. DoC
   * certification status is never used as a standalone project-ownership
   * confirmation mechanism.
   */
  async confirmProject(id: string, actor: Actor): Promise<Artifact> {
    const project = await this.requireProject(id);
    const owner = project.attributes['owner'] as ProjectOwner | undefined;
    if (!owner || typeof owner.userId !== 'string' || owner.userId.trim().length === 0) {
      throw new Error(`Project ${id} has no valid owner; cannot confirm ownership.`);
    }
    assertMode(String(project.attributes['mode']));
    if (project.attributes['lifecycleComplete'] === undefined) {
      throw new Error(
        `Project ${id} has no lifecycle-complete marker; cannot confirm scoping.`,
      );
    }
    await this.services.evidence.append({
      kind: 'inspection',
      summary: `Project ${id} ownership/scope confirmed (owner=${owner.userId}).`,
      artifactIds: [id],
      producer: actor,
    });
    return project;
  }

  async getProject(id: string): Promise<Artifact | null> {
    const artifact = await this.services.store.get(id);
    if (artifact === null || artifact.type !== 'PROJECT') return null;
    return artifact;
  }

  async requireProject(id: string): Promise<Artifact> {
    const project = await this.getProject(id);
    if (project === null) {
      throw new Error(`Project "${id}" does not exist (or is not a PROJECT artifact).`);
    }
    return project;
  }

  /** List every PROJECT artifact currently in the store. */
  async listProjects(): Promise<Artifact[]> {
    return this.services.store.list({ types: ['PROJECT'] });
  }

  /** The project's declared mode, read from its stored attributes. */
  async getMode(id: string): Promise<ProjectMode> {
    const project = await this.requireProject(id);
    const mode = project.attributes['mode'];
    assertMode(String(mode));
    return mode as ProjectMode;
  }

  /** True when the stage is within the project's declared mode scope. */
  async isStageInScope(id: string, stageId: string): Promise<boolean> {
    const mode = await this.getMode(id);
    return stageInScope(mode, stageId);
  }

  /** The lifecycle stage at which the project is "complete within scope". */
  async lifecycleComplete(id: string): Promise<string> {
    const mode = await this.getMode(id);
    return PROJECT_MODE_LIFECYCLE_COMPLETE[mode];
  }

  /**
   * Returns the project that CONTAINS the given artifact, if any, via the
   * Knowledge Graph's existing CONTAINS relation.
   */
  async projectOfArtifact(artifactId: string): Promise<Artifact | null> {
    const upstream = this.services.graph.neighbors(
      artifactId,
      'upstream',
      'CONTAINS',
    );
    for (const candidateId of upstream) {
      const candidate = await this.getProject(candidateId);
      if (candidate !== null) return candidate;
    }
    return null;
  }

  /** Links an existing artifact under a project via a CONTAINS edge. */
  async linkArtifact(projectId: string, artifactId: string): Promise<void> {
    await this.requireProject(projectId);
    await this.services.store.require(artifactId);
    this.services.graph.addNode(projectId);
    this.services.graph.addNode(artifactId);
    this.services.graph.link(projectId, 'CONTAINS', artifactId);
  }

  // --- Structured project configuration / initialization (expansion §5) ----

  /**
   * Reads the project's structured configuration. If the project has not been
   * configured yet, derives a default from the global AppConfig (env-driven)
   * and the project's declared mode - so configuration is always available and
   * initialization is explicit but defaults are sane.
   */
  async getConfiguration(id: string, app?: AppConfig): Promise<ProjectConfiguration> {
    const project = await this.requireProject(id);
    const mode = project.attributes['mode'] as ProjectMode;
    assertMode(String(mode));
    const stored = project.attributes['projectConfig'] as
      | Readonly<Record<string, unknown>>
      | undefined;
    const fallback = defaultProjectConfiguration(mode, {
      dataDir: app?.dataDir ?? './data',
      logLevel: app?.logLevel ?? 'info',
    });
    // A previously configured project carries an explicit configuration stamp;
    // an unconfigured project yields the default derived from mode + app.
    if (stored && stored['normalized'] === true) {
      return normalizeProjectConfiguration(stored, fallback);
    }
    return fallback;
  }

  /**
   * Applies (or replaces) the project's structured configuration after
   * validation. The normalized payload is stamped as `normalized: true` and
   * stored on the PROJECT artifact's attributes. Fails closed on invalid
   * configuration without modifying the stored project.
   */
  async configureProject(
    id: string,
    raw: Readonly<Record<string, unknown>>,
    app?: AppConfig,
  ): Promise<ProjectConfiguration> {
    const project = await this.requireProject(id);
    const fallback = await this.getConfiguration(id, app);
    const normalized = normalizeProjectConfiguration(raw, fallback);

    const updated = await this.services.store.update(id, project.version, (draft) => ({
      ...draft,
      attributes: {
        ...draft.attributes,
        projectConfig: {
          ...normalized,
          normalized: true,
        },
        lifecycleComplete: PROJECT_MODE_LIFECYCLE_COMPLETE[normalized.mode],
      },
    }));
    await this.services.evidence.append({
      kind: 'inspection',
      summary: `Project ${id} configured (mode=${normalized.mode}).`,
      artifactIds: [id],
      producer: { kind: 'system', id: 'project-registry' },
    });
    return this.readStoredConfig(updated);
  }

  /**
   * Explicitly initializes a project with its default configuration derived
   * from the global AppConfig + the project's mode. Returns the resulting
   * configuration. This is the lightweight "initialization" entry point; the
   * project is already created/adopted, and initialization just establishes a
   * validated default config so all downstream stages read deterministic
   * settings.
   */
  async initializeProject(id: string, app?: AppConfig): Promise<ProjectConfiguration> {
    const project = await this.requireProject(id);
    const fallback = await this.getConfiguration(id, app);
    const hasConfig =
      project.attributes['projectConfig'] !== undefined &&
      (project.attributes['projectConfig'] as { normalized?: boolean })['normalized'] === true;
    if (hasConfig) {
      return this.readStoredConfig(project);
    }
    const raw = { ...fallback } as unknown as Record<string, unknown>;
    raw['normalized'] = true;
    const updated = await this.services.store.update(id, project.version, (draft) => ({
      ...draft,
      attributes: {
        ...draft.attributes,
        projectConfig: {
          ...fallback,
          normalized: true,
        },
      },
    }));
    await this.services.evidence.append({
      kind: 'inspection',
      summary: `Project ${id} initialized with default configuration.`,
      artifactIds: [id],
      producer: { kind: 'system', id: 'project-registry' },
    });
    return this.readStoredConfig(updated);
  }

  /**
   * Sets a single per-task provider/model preference on the project, keeping
   * all other configuration intact (additive update).
   */
  async setProviderPreference(
    id: string,
    task: AiTaskType,
    preference: ProviderPreference,
    app?: AppConfig,
  ): Promise<ProjectConfiguration> {
    if (preference.providerId.trim().length === 0) {
      throw new Error('Provider preference requires a non-empty providerId.');
    }
    const current = await this.getConfiguration(id, app);
    const project = await this.requireProject(id);
    const providers: Partial<Record<AiTaskType, ProviderPreference>> = {
      ...current.providers,
    };
    providers[task] = preference;
    const next: ProjectConfiguration = { ...current, providers };
    const updated = await this.services.store.update(id, project.version, (draft) => ({
      ...draft,
      attributes: {
        ...draft.attributes,
        projectConfig: {
          ...next,
          normalized: true,
        },
      },
    }));
    return this.readStoredConfig(updated);
  }

  private readStoredConfig(project: Artifact): ProjectConfiguration {
    const stored = project.attributes['projectConfig'] as Readonly<Record<string, unknown>>;
    const mode = stored['mode'] as ProjectMode;
    assertMode(String(mode));
    return normalizeProjectConfiguration(stored, {
      mode,
      providers: {},
      features: {
        qaAlongsideDevelopment: true,
        safeChange: true,
        continuousEngineering: true,
        recursionDiscovery: false,
        permanentEngineeringOrg: false,
      },
      qualityGates: {
        requireMasterPass: true,
        requireCouncilEndorsement: true,
        requireCompleteTraceability: true,
      },
      runtime: { dataDir: './data', logLevel: 'info' },
    });
  }
}

/** Read a project config payload back from a PROJECT artifact. */
export function projectConfigOf(project: Artifact): ProjectConfig {
  const owner = project.attributes['owner'] as ProjectOwner | undefined;
  return {
    mode: project.attributes['mode'] as ProjectMode,
    owner: owner ?? { userId: '' },
    scope: (project.attributes['scope'] as readonly string[] | undefined) ?? [],
    config: (project.attributes['projectConfig'] as Readonly<Record<string, unknown>> | undefined) ?? {},
  };
}
