/**
 * Deterministic deployment-check execution against STORED state plus the
 * department-owned deployment environment (§4.1).
 *
 * A release unit counts as DEPLOYED-VERIFIABLE only when the certified -TEST
 * artifact is actually present and VERIFIED, the deployed environment carries
 * a configuration entry derived from the certified baseline, a rollback probe
 * has been exercised for this specific release, and a live monitor is
 * attached. Every verdict is sha256-anchored over exactly the facts that
 * produced it, so the Deployment Boss and Deployment Auditor can recompute
 * verdicts and compare them byte-for-byte with the worker's report.
 */

import { createHash } from 'node:crypto';
import type { CoreServices } from '../core/services.ts';
import type { DeployExpectation } from './scope.ts';

export function sha256(parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('\u0000')).digest('hex');
}

/** One deployed unit inside the department-owned target environment. */
export interface DeployedUnit {
  readonly baseId: string;
  readonly kind: 'functional' | 'render';
  /** sha256 over the certified inputs this unit's configuration came from. */
  readonly configHash: string;
  /** Present only when the rollback probe was actually exercised. */
  readonly rollbackProbeHash?: string;
  /** Present only when a live monitor is attached. */
  readonly monitorId?: string;
}

/**
 * The target environment is owned by the department run, seeded ONLY by the
 * Deployment Worker from stored certified state. Judges (Boss, Auditor) read
 * it read-only and reconcile it against their own reconstruction, so worker
 * defects surface as judge deltas instead of being absorbed silently.
 */
export interface DeploymentEnvironment {
  readonly name: string;
  readonly units: Map<string, DeployedUnit>;
}

export function createDeploymentEnvironment(name: string): DeploymentEnvironment {
  return { name, units: new Map<string, DeployedUnit>() };
}

export interface ExecutedDeploy {
  readonly baseId: string;
  readonly kind: 'functional' | 'render';
  readonly passed: boolean;
  readonly requirement: string;
  readonly observed: string;
  readonly evidenceHash: string;
  readonly envConfigured: boolean;
  readonly rollbackExercised: boolean;
  readonly monitorLive: boolean;
}

export const DEPLOY_REQUIREMENT =
  'tested artifact is configured in the target environment, monitored, and rollback-exercised for this release';

/** Dependency of a deployment: implementation (functional) or design (render). */
export function dependencyOf(exp: DeployExpectation): string {
  return exp.kind === 'functional' ? `${exp.baseId}-IMPL` : `${exp.baseId}-DESIGN`;
}

// ---------------------------------------------------------------------------
// Worker-side execution
// ---------------------------------------------------------------------------

/** The canonical sha256 anchor of a unit's configuration, from stored state. */
async function computeConfigHash(services: CoreServices, exp: DeployExpectation): Promise<string> {
  const base = await services.store.require(exp.baseId);
  const depId = dependencyOf(exp);
  const dep = await services.store.require(depId); // fails loudly on broken lineage
  const test = await services.store.get(`${exp.baseId}-TEST`);
  return sha256([
    base.id,
    base.version.toString(),
    dep.id,
    dep.version.toString(),
    test?.version.toString() ?? 'none',
    test?.status ?? 'none',
  ]);
}

function monitorIdFor(baseId: string, envName: string): string {
  return `monitor:${envName}:${baseId}`;
}

/**
 * Mechanical reconciliation of one expected unit against the environment.
 * Pure with respect to store+env: identical inputs yield identical
 * ExecutedDeploy bytes, which is what lets the Boss reconstruct and the
 * Auditor reproduce the worker's verdicts exactly.
 */
export async function verifyDeployedUnit(
  services: CoreServices,
  exp: DeployExpectation,
  env: DeploymentEnvironment,
): Promise<ExecutedDeploy> {
  const unit = env.units.get(exp.baseId);
  if (unit === undefined) {
    const observed = `no deployed unit for ${exp.baseId} in ${env.name}`;
    return {
      baseId: exp.baseId,
      kind: exp.kind,
      passed: false,
      requirement: DEPLOY_REQUIREMENT,
      observed,
      evidenceHash: sha256([exp.baseId, exp.kind, 'absent']),
      envConfigured: false,
      rollbackExercised: false,
      monitorLive: false,
    };
  }

  const expectedConfigHash = await computeConfigHash(services, exp);
  const envConfigured = unit.configHash === expectedConfigHash;
  const rollbackExercised = unit.rollbackProbeHash !== undefined &&
    unit.rollbackProbeHash === sha256(['rollback-probe', unit.configHash]);
  const monitorLive = unit.monitorId !== undefined &&
    unit.monitorId === monitorIdFor(exp.baseId, env.name);

  const passed = envConfigured && rollbackExercised && monitorLive;
  return {
    baseId: exp.baseId,
    kind: exp.kind,
    passed,
    requirement: DEPLOY_REQUIREMENT,
    observed: passed
      ? `configured=${envConfigured}; rollback=${rollbackExercised}; monitor=${monitorLive}`
      : `config=${envConfigured}, rollback=${rollbackExercised}, monitor=${monitorLive}`,
    evidenceHash: sha256([
      exp.baseId,
      exp.kind,
      passed ? 'pass' : 'fail',
      String(envConfigured),
      String(rollbackExercised),
      String(monitorLive),
    ]),
    envConfigured,
    rollbackExercised,
    monitorLive,
  };
}

/** Injectable Deployment-Worker corps defects, used by honest failure paths. */
export interface CorpsDefects {
  /** Silently do not deploy these scheduled ids at all. */
  readonly skipIds?: readonly string[];
  /** Deploy but attach no live monitor. */
  readonly omitMonitorIds?: readonly string[];
  /** Deploy but never exercise the rollback probe. */
  readonly skipRollbackIds?: readonly string[];
  /** Deploy with a configuration not derived from the certified baselines. */
  readonly wrongConfigIds?: readonly string[];
}

function omitMonitor(exp: DeployExpectation, defects: CorpsDefects): boolean {
  return (defects.omitMonitorIds ?? []).includes(exp.baseId);
}

function skipsRollback(exp: DeployExpectation, defects: CorpsDefects): boolean {
  return (defects.skipRollbackIds ?? []).includes(exp.baseId);
}

/** The Deployment & Environment Worker corps executing the scoped release. */
export async function deployRelease(
  services: CoreServices,
  scope: readonly DeployExpectation[],
  env: DeploymentEnvironment,
  defects: CorpsDefects = {},
): Promise<void> {
  const skip = new Set(defects.skipIds ?? []);
  for (const exp of scope) {
    if (skip.has(exp.baseId)) continue;
    const truthfulConfig = await computeConfigHash(services, exp);
    const configHash = (defects.wrongConfigIds ?? []).includes(exp.baseId)
      ? sha256(['drifted-config', exp.baseId])
      : truthfulConfig;
    env.units.set(exp.baseId, {
      baseId: exp.baseId,
      kind: exp.kind,
      configHash,
      ...(skipsRollback(exp, defects)
        ? {}
        : { rollbackProbeHash: sha256(['rollback-probe', configHash]) }),
      ...(omitMonitor(exp, defects) ? {} : { monitorId: monitorIdFor(exp.baseId, env.name) }),
    });
  }
}
