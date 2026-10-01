/**
 * Durable persistence for the product-judgment layer (§105-§110).
 *
 * The decision ledger, the immutable intent baseline and every simulation
 * finding are append-only durable state: they must survive a restart, because
 * "a later engineer must be able to understand why a major product or
 * technical choice exists" (§108) is a durability requirement, not a
 * convenience.
 */

import { join } from 'node:path';
import type { Artifact } from '../core/artifact.ts';
import { JsonFileStore } from '../web/durable.ts';
import {
  establishIntent,
  detectIntentDrift,
  judgeProduct,
  type AmbiguityResolution,
  type DecisionLedger,
  type DecisionRecord,
  type IntentDrift,
  type IntentTrace,
  type ProductIntent,
  type ProductJudgmentReport,
} from './product-judgment.ts';
import { runProductSimulations, type SimulationReport } from './simulation.ts';

const SCHEMA_VERSION = 1;

interface JudgmentSnapshot {
  nextDecisionSeq: number;
  intents: ProductIntent[];
  decisions: DecisionRecord[];
  drift: IntentDrift[];
  reports: ProductJudgmentReport[];
  simulations: SimulationReport[];
}

export function judgmentFilePath(dataDir: string): string {
  return join(dataDir, 'judgment.json');
}

/** A durable, append-only decision ledger plus the intent baseline it serves. */
export class DurableJudgmentLedger implements DecisionLedger {
  private readonly file: JsonFileStore<JudgmentSnapshot>;
  private snapshot: JudgmentSnapshot = {
    nextDecisionSeq: 1,
    intents: [],
    decisions: [],
    drift: [],
    reports: [],
    simulations: [],
  };
  private loaded = false;

  constructor(filePath: string) {
    this.file = new JsonFileStore<JudgmentSnapshot>({ filePath, schemaVersion: SCHEMA_VERSION });
  }

  async init(): Promise<void> {
    if (this.loaded) return;
    const prior = await this.file.load();
    if (prior !== null) this.snapshot = prior;
    this.loaded = true;
  }

  private async ensureLoaded(): Promise<void> {
    if (!this.loaded) await this.init();
  }

  private async persist(): Promise<void> {
    await this.file.save(this.snapshot);
  }

  /** Establishes (once) the immutable product intent baseline for a project. */
  async establishIntentBaseline(
    input: Omit<ProductIntent, 'anchor' | 'establishedAt'> & { at?: string },
  ): Promise<ProductIntent> {
    await this.ensureLoaded();
    const existing = this.snapshot.intents.find((i) => i.projectId === input.projectId);
    if (existing !== undefined) {
      // The baseline is immutable: a second establishment is a no-op, never an
      // overwrite. Amendment goes through the Change/Reopening process.
      return existing;
    }
    const intent = establishIntent(input);
    this.snapshot.intents.push(intent);
    await this.persist();
    return intent;
  }

  intentOf(projectId: string): ProductIntent | null {
    return this.snapshot.intents.find((i) => i.projectId === projectId) ?? null;
  }

  record(decision: Omit<DecisionRecord, 'id'> & { id?: string }): DecisionRecord {
    const id = decision.id ?? `DEC-${String(this.snapshot.nextDecisionSeq).padStart(6, '0')}`;
    if (this.byId(id) !== null) {
      throw new Error(`Decision "${id}" already exists in the ledger; decisions are append-only.`);
    }
    this.snapshot.nextDecisionSeq += 1;
    const record: DecisionRecord = Object.freeze({
      ...decision,
      id,
      evidenceIds: Object.freeze([...decision.evidenceIds]),
      alternativesConsidered: Object.freeze([...decision.alternativesConsidered]),
      affectedArtifactIds: Object.freeze([...decision.affectedArtifactIds]),
    });
    this.snapshot.decisions.push(record);
    void this.persist();
    return record;
  }

  forProject(projectId: string): readonly DecisionRecord[] {
    return this.snapshot.decisions.filter((d) => d.projectId === projectId);
  }

  byId(id: string): DecisionRecord | null {
    return this.snapshot.decisions.find((d) => d.id === id) ?? null;
  }

  /** Recomputes and durably records intent drift for a project. */
  async recordDrift(input: {
    projectId: string;
    subjects: readonly { id: string; label: string; trace: IntentTrace | null }[];
    at?: string;
  }): Promise<readonly IntentDrift[]> {
    await this.ensureLoaded();
    const intent = this.intentOf(input.projectId);
    if (intent === null) return [];
    const found = detectIntentDrift({ ...input, intent });
    // Append-only by (id): a re-run that finds the same drift does not duplicate it.
    for (const d of found) {
      if (!this.snapshot.drift.some((existing) => existing.id === d.id)) this.snapshot.drift.push(d);
    }
    await this.persist();
    return found;
  }

  driftFor(projectId: string): readonly IntentDrift[] {
    return this.snapshot.drift.filter((d) => d.projectId === projectId);
  }

  /** Runs the independent product-judgment pass against real project state. */
  async runJudgment(input: {
    projectId: string;
    artifacts: readonly Artifact[];
    stages: readonly { id: string; label: string; inScope: boolean; status: string }[];
    at?: string;
  }): Promise<ProductJudgmentReport> {
    await this.ensureLoaded();
    const pageCount = input.artifacts.filter((a) => a.type === 'PAGE').length;
    const roleCount = input.artifacts.filter((a) => a.type === 'PERMISSION' || a.type === 'WORKFLOW').length;
    const workflowCount = input.artifacts.filter((a) => a.type === 'WORKFLOW').length;
    const report = judgeProduct({
      projectId: input.projectId,
      stages: input.stages,
      pageCount,
      roleCount,
      workflowCount,
      driftofIntent: this.driftFor(input.projectId),
      openDecisions: this.forProject(input.projectId).filter((d) => d.resolution === 'human-decision-required'),
      ...(input.at !== undefined ? { at: input.at } : {}),
    });
    this.snapshot.reports.push(report);
    await this.persist();
    return report;
  }

  latestJudgment(projectId: string): ProductJudgmentReport | null {
    const mine = this.snapshot.reports.filter((r) => r.projectId === projectId);
    return mine.length === 0 ? null : mine[mine.length - 1]!;
  }

  /** Runs both §109 user simulation and §110 adversarial simulation. */
  async runSimulations(input: { projectId: string; artifacts: readonly Artifact[]; at?: string }): Promise<SimulationReport> {
    await this.ensureLoaded();
    const report = runProductSimulations(input);
    this.snapshot.simulations.push(report);
    await this.persist();
    return report;
  }

  latestSimulation(projectId: string): SimulationReport | null {
    const mine = this.snapshot.simulations.filter((r) => r.projectId === projectId);
    return mine.length === 0 ? null : mine[mine.length - 1]!;
  }
}

export type { AmbiguityResolution, DecisionRecord, ProductIntent, ProductJudgmentReport, SimulationReport };
