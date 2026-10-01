/**
 * Platform Startup Gate (LAW - PLATFORM STARTUP GATE).
 *
 * Before accepting production engineering work the platform verifies the
 * health and compatibility of its required execution foundation: OpenCode AI
 * execution, Cline Worker/agent execution, Daytona project execution
 * environment and the durable local mechanism. A degraded foundation is never
 * represented as ready.
 *
 * OpenCode, Cline and Daytona are mandatory components. When any of them is
 * NOT_INSTALLED on the host, `productionReady` is false; the platform keeps
 * operating honestly in `development-local` mode around the mechanisms that
 * really exist (real local workspaces, real model calls, real sessions) while
 * every report states exactly which mandatory component is absent.
 */

import type { CapabilityDecision, ExecutionCapability } from './capabilities.ts';

export type FoundationPolicy = 'production' | 'development-local';

/**
 * §134 PLATFORM STARTUP GATE — the control-plane foundations that must be
 * verified before production engineering work is accepted. These are probed
 * with REAL operations at boot (a real durable write, a real event publish, a
 * real scheduler pass, a real secret-boundary round trip, a real observability
 * read), never declared.
 */
export type ControlPlaneCapability =
  | 'durable-storage'
  | 'event-delivery'
  | 'job-state'
  | 'scheduler'
  | 'secret-boundary'
  | 'observability';

export interface ControlPlaneDecision {
  readonly capability: ControlPlaneCapability;
  readonly ready: boolean;
  /** Exactly what was probed and what the probe returned. */
  readonly detail: string;
  readonly checkedAt: string;
}

export interface FoundationReport {
  readonly generatedAt: string;
  readonly capabilities: readonly CapabilityDecision[];
  /** Real boot-time probes of the control-plane foundations (§134). */
  readonly controlPlane: readonly ControlPlaneDecision[];
  readonly opencodeReady: boolean;
  readonly clineReady: boolean;
  readonly daytonaReady: boolean;
  readonly localReady: boolean;
  /** True only when EVERY mandatory component is present and healthy. */
  readonly productionReady: boolean;
  /** True only when every mandatory component AND every control-plane probe passed. */
  readonly startupGateOpen: boolean;
  readonly policy: FoundationPolicy;
  /** Where new environments are really provisioned right now. */
  readonly environmentBackend: 'local-workspace' | 'daytona';
  readonly summary: string;
}

export interface FoundationInput {
  readonly capabilities: readonly CapabilityDecision[];
  /** Real boot-time probes of the control-plane foundations (§134). */
  readonly controlPlane?: readonly ControlPlaneDecision[];
  /** Which real backend backs new environments right now. */
  readonly environmentBackend: 'local-workspace' | 'daytona';
}

const MANDATORY: readonly ExecutionCapability[] = ['opencode', 'cline', 'daytona'];

function readyFor(capabilities: readonly CapabilityDecision[], capability: ExecutionCapability): boolean {
  return capabilities.some((c) => c.capability === capability && c.status === 'READY');
}

export function assessFoundation(input: FoundationInput): FoundationReport {
  const generatedAt = new Date().toISOString();
  const controlPlane = input.controlPlane ?? [];
  const opencodeReady = readyFor(input.capabilities, 'opencode');
  const clineReady = readyFor(input.capabilities, 'cline');
  const daytonaReady = readyFor(input.capabilities, 'daytona');
  const localReady = readyFor(input.capabilities, 'local-workspace');
  const productionReady = opencodeReady && clineReady && daytonaReady;
  const controlPlaneReady = controlPlane.every((c) => c.ready);
  // §134: a degraded foundation must never be represented as ready. The gate is
  // open only when every mandatory component AND every control-plane probe is
  // green; a failed control-plane probe closes the gate on its own.
  const startupGateOpen = productionReady && controlPlaneReady;
  const policy: FoundationPolicy = startupGateOpen ? 'production' : 'development-local';
  const missing = MANDATORY.filter((c) => !readyFor(input.capabilities, c));
  const failedProbes = controlPlane.filter((c) => !c.ready);
  const summary = startupGateOpen
    ? 'All mandatory execution components (OpenCode, Cline, Daytona) are present and healthy, and every control-plane foundation probe passed; the platform is production-ready.'
    : `Not production-ready. ${missing.length > 0 ? `Mandatory component(s) absent or unhealthy: ${missing.join(', ')}. ` : ''}${failedProbes.length > 0 ? `Control-plane foundation probe(s) failed: ${failedProbes.map((c) => c.capability).join(', ')}. ` : ''}Local development continues honestly through the real mechanisms present; no missing component is simulated or claimed.`;
  return {
    generatedAt,
    capabilities: [...input.capabilities],
    controlPlane,
    opencodeReady,
    clineReady,
    daytonaReady,
    localReady,
    productionReady,
    startupGateOpen,
    policy,
    environmentBackend: input.environmentBackend,
    summary,
  };
}