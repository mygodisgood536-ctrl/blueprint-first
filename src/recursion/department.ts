/**
 * Continuous Discovery Recursion Department (Level 4, spec §5.2).
 *
 * Receives the current drift report and a prior drift report, classifies
 * the delta, and routes `actionable` + `regression` items through the
 * Safe Change Department. The output is a complete audit trail covering
 * both the classification decision and every remediation attempt.
 */
import type { CoreServices } from '../core/services.ts';
import type { DriftItem } from '../verification/live-engine.ts';
import { runSafeChangeDepartment, type ChangeDepartmentResult } from '../change/department.ts';
import type { DeployedUnit } from '../operations/deploy.ts';
import { classifyDeltas, type RecursionResult, type RecursionMemory } from './recursion.ts';

export interface RecursionDepartmentInput {
  readonly prior: readonly DriftItem[];
  readonly current: readonly DriftItem[];
  readonly projectId: string;
  readonly env: { units: Map<string, DeployedUnit> };
  /** Apply after the Safe Change Department authorizes. */
  readonly apply: boolean;
  readonly memory?: RecursionMemory;
  readonly expectedBaseIds?: ReadonlySet<string>;
}

export interface RecursionDepartmentResult {
  readonly classification: RecursionResult;
  /** Per-item change-department result for each actionable/regression. */
  readonly changes: readonly {
    readonly drift: DriftItem;
    readonly result: ChangeDepartmentResult;
  }[];
  /** True when every actionable item was APPLIED. */
  readonly allRemediated: boolean;
}

export async function runRecursionDepartment(
  services: CoreServices,
  input: RecursionDepartmentInput,
): Promise<RecursionDepartmentResult> {
  const classification = classifyDeltas({
    prior: input.prior,
    current: input.current,
    ...(input.memory !== undefined ? { memory: input.memory } : {}),
    ...(input.expectedBaseIds !== undefined ? { expectedBaseIds: input.expectedBaseIds } : {}),
  });
  const changes: { drift: DriftItem; result: ChangeDepartmentResult }[] = [];
  for (const item of [...classification.regressions, ...classification.actionable.filter(
    (a) => !classification.regressions.some((r) => r.artifactId === a.artifactId && r.dimension === a.dimension),
  )]) {
    const result = await runSafeChangeDepartment(services, {
      drift: item,
      projectId: input.projectId,
      env: input.env,
      apply: input.apply,
    });
    changes.push({ drift: item, result });
  }
  const allRemediated = changes.length === 0
    ? true
    : changes.every((c) => c.result.status === 'AUTHORIZED_AND_APPLIED');
  return { classification, changes, allRemediated };
}
