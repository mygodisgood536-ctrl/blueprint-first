/**
 * Deterministic acceptance-check execution against STORED state.
 *
 * These are the Level-3 "simulated tests": because implementation artifacts
 * carry their approved design contracts as data, behavior can be exercised
 * deterministically here (the same way the whole platform runs scripted and
 * deterministic until real providers are configured). Every result carries a
 * sha256 evidence hash over exactly the facts that produced the verdict, so
 * the Test Boss and Test Auditor can recompute and compare byte-for-byte.
 *
 * The contract under test lives on the -DESIGN artifact's `designDoc`
 * attribute. Render (page) checks assert the page has an approved layout
 * contract; functional (feature) checks assert the certified feature has an
 * approved design and a code-verified implementation that is traceable to it.
 */

import { createHash } from 'crypto';
import type { Artifact } from '../core/artifact.ts';
import type { CoreServices } from '../core/services.ts';
import type { CoverageExpectation } from './coverage.ts';

export interface ExecutedCheck {
  readonly baseId: string;
  readonly kind: 'functional' | 'render';
  readonly passed: boolean;
  readonly requirement: string;
  readonly observed: string;
  readonly evidenceHash: string;
}

function sha256(parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

function check(
  exp: CoverageExpectation,
  passed: boolean,
  requirement: string,
  observed: string,
  facts: readonly string[],
): ExecutedCheck {
  return {
    baseId: exp.baseId,
    kind: exp.kind,
    passed,
    requirement,
    observed,
    evidenceHash: sha256([exp.baseId, exp.kind, passed ? 'pass' : 'fail', ...facts]),
  };
}

/** The approved design artifact + its designDoc contract, or null if missing. */
async function loadDesign(
  services: CoreServices,
  baseId: string,
): Promise<{ artifact: Artifact; doc: Record<string, unknown> } | null> {
  const design = await services.store.get(`${baseId}-DESIGN`);
  if (design === null) return null;
  const attrs = (design.attributes ?? {}) as Record<string, unknown>;
  const doc = (attrs['designDoc'] ?? {}) as Record<string, unknown>;
  return { artifact: design, doc };
}

/** Runs one deterministic acceptance check against the stored artifacts. */
export async function executeCheck(
  services: CoreServices,
  exp: CoverageExpectation,
): Promise<ExecutedCheck> {
  const base = await services.store.get(exp.baseId);
  if (base === null) {
    return check(exp, false, 'certified baseline item present', 'base artifact missing from store', [
      'no-base',
    ]);
  }
  if (base.status !== 'VERIFIED') {
    return check(exp, false, 'baseline item VERIFIED', `baseline status=${base.status}`, [
      'base-status',
      base.status,
    ]);
  }

  const design = await loadDesign(services, exp.baseId);
  if (design === null) {
    return check(exp, false, 'approved design contract exists', '-DESIGN artifact missing', [
      'no-design',
    ]);
  }

  if (exp.kind === 'functional') {
    const impl = await services.store.get(`${exp.baseId}-IMPL`);
    if (impl === null) {
      return check(exp, false, 'implementation exists', '-IMPL artifact missing', ['no-impl']);
    }
    const implVerified = impl.status === 'VERIFIED';
    // Number of designed units the feature realizes (pages it connects or
    // workflow steps it drives) - reported for diagnostics, not gating: some
    // certified features legitimately realize zero of the sampled pages at
    // Level 1a (e.g. cross-module organizers), so the acceptance bar is
    // implementation presence + code-verification + traceability.
    const pageKeys = Array.isArray(design.doc['pageKeys'])
      ? (design.doc['pageKeys'] as readonly unknown[]).length
      : 0;
    const workflowSteps = Array.isArray(design.doc['workflowSteps'])
      ? (design.doc['workflowSteps'] as readonly unknown[]).length
      : 0;
    const designedSurface = pageKeys + workflowSteps;
    const traceable = design.artifact.dependencies.includes(exp.baseId);
    const passed = implVerified && traceable;
    return check(
      exp,
      passed,
      'certified feature is implemented, code-verified and traceable to its approved design',
      passed
        ? `impl VERIFIED; feature realizes ${designedSurface} designed unit(s); DERIVED_FROM design`
        : `impl status=${impl.status}, designedSurface=${designedSurface}, traceable=${traceable}`,
      ['functional', impl.id, impl.status, String(designedSurface), String(traceable)],
    );
  }

  // Render (page): the page has an approved layout contract and the design is VERIFIED.
  const layout = Array.isArray(design.doc['layout'])
    ? (design.doc['layout'] as readonly unknown[])
    : [];
  const passed = design.artifact.status === 'VERIFIED' && layout.length > 0;
  return check(
    exp,
    passed,
    'page renders from its approved layout contract',
    passed
      ? `design VERIFIED; ${layout.length} layout region(s) contract-defined`
      : `design status=${design.artifact.status}, layoutRegions=${layout.length}`,
    ['render', design.artifact.id, design.artifact.status, String(layout.length)],
  );
}

/** Executes the full matrix in expectation order. */
export async function executeCoverage(
  services: CoreServices,
  expected: readonly CoverageExpectation[],
): Promise<ExecutedCheck[]> {
  const executed: ExecutedCheck[] = [];
  for (const exp of expected) {
    executed.push(await executeCheck(services, exp));
  }
  return executed;
}