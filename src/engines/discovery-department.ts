/**
 * Discovery Department - Level 1b contract.
 *
 * IMPLEMENTED by src/discovery/department/engine.ts (DiscoveryDepartment):
 * Worker Corps Clusters A (Understanding) and B (Structural) with §0.14
 * self-verification, one independent Specialist Verifier per cluster, and a
 * lightweight Discovery Boss performing independent reconstruction on core
 * artifact types (pages, features, workflows) only - producing the same
 * verified baseline contract as the Level-1a single-pass engine while
 * replacing its single reasoning path with the spec's organization.
 */

import type { EngineDescriptor } from './scaffold.ts';
import type { ProductUnderstandingBrief } from '../discovery/types.ts';
import type { DepartmentRunResult } from '../discovery/department/types.ts';

export interface DiscoveryDepartmentContract {
  readonly descriptor: EngineDescriptor;
  discover(brief: ProductUnderstandingBrief): Promise<DepartmentRunResult>;
}

export type { DepartmentRunResult } from '../discovery/department/types.ts';