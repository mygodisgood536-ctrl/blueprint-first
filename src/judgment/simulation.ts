/**
 * Real User Simulation and Adversarial Product Simulation
 * (ARCHITECTURE 3.3, §109-§110), run before final product certification.
 *
 *   §109 REAL USER SIMULATION - exercise representative users: new users,
 *        experienced users, mobile users, tablet users, accessibility-oriented
 *        users, slow-network users and error-prone users where relevant.
 *        Findings become traceable defects or certified observations.
 *   §110 ADVERSARIAL PRODUCT SIMULATION - actively attempt to PROVE THE
 *        FINISHED PRODUCT WRONG across workflows, permissions, navigation,
 *        business rules, data consistency, UI states, accessibility,
 *        performance, security, integrations, recovery and edge cases.
 *        Passing ordinary tests does not close adversarial simulation.
 *
 * Both simulations are EVIDENCE-DERIVED, not invented. Each check inspects the
 * real certified inventory the platform actually holds and reports exactly what
 * it examined. A check whose subject does not exist in this project is reported
 * as NOT-APPLICABLE with its reason - never as a pass, and never as a failure
 * the product did not earn. Nothing here certifies anything; the findings are
 * inputs to the final certification council (§137).
 */

import { createHash } from 'node:crypto';
import type { Artifact } from '../core/artifact.ts';

// ── shared finding model ─────────────────────────────────────────────────────

export type SimulationSeverity = 'defect' | 'observation' | 'not-applicable';

export interface SimulationFinding {
  readonly id: string;
  readonly simulation: 'user-simulation' | 'adversarial-simulation';
  readonly persona?: UserPersona['key'];
  readonly dimension: string;
  /** The specific subject this check attacked (an id, class, or gap name). */
  readonly subject: string;
  readonly severity: SimulationSeverity;
  readonly detail: string;
  /** The real artifacts this check actually inspected. */
  readonly examinedArtifactIds: readonly string[];
  readonly at: string;
}

export interface SimulationReport {
  readonly projectId: string;
  readonly generatedAt: string;
  readonly userSimulation: readonly SimulationFinding[];
  readonly adversarialSimulation: readonly SimulationFinding[];
  readonly defects: number;
  readonly observations: number;
  readonly notApplicable: number;
  readonly summary: string;
}

// ── §109 real user simulation ───────────────────────────────────────────────

export const USER_PERSONAS = [
  { key: 'new-user', label: 'New user — no context, no learned habits' },
  { key: 'experienced-user', label: 'Experienced user — expects shortcuts and density' },
  { key: 'mobile-user', label: 'Mobile user — small viewport, touch, intermittent' },
  { key: 'tablet-user', label: 'Tablet user — medium viewport, touch plus pointer' },
  { key: 'accessibility-oriented-user', label: 'Accessibility-oriented user — keyboard and screen reader' },
  { key: 'slow-network-user', label: 'Slow-network user — long latency, partial responses' },
  { key: 'error-prone-user', label: 'Error-prone user — double submits, stale forms, bad input' },
] as const;

export type UserPersona = (typeof USER_PERSONAS)[number];

function findingId(projectId: string, simulation: string, dimension: string, subject: string): string {
  return `SIM-${createHash('sha256').update(`${projectId}\u0000${simulation}\u0000${dimension}\u0000${subject}`, 'utf8').digest('hex').slice(0, 12).toUpperCase()}`;
}

function artifactIds(artifacts: readonly Artifact[], type: string): readonly string[] {
  return artifacts.filter((a) => a.type === type).map((a) => a.id);
}

function hasLayer(page: Artifact, layer: string): boolean {
  const layers = page.attributes['layers'];
  if (Array.isArray(layers)) return layers.includes(layer);
  const expansion = page.attributes['layerRecords'];
  if (Array.isArray(expansion)) {
    return expansion.some((r) => typeof r === 'object' && r !== null && (r as Record<string, unknown>)['layerName'] === layer);
  }
  return false;
}

/**
 * Exercises each representative persona against the REAL inventory. A persona
 * defect is raised only when the inventory genuinely lacks the substrate that
 * persona needs; when the substrate is absent because the product has no such
 * surface at all, the result is recorded as not-applicable with the reason.
 */
export function runUserSimulation(input: {
  projectId: string;
  artifacts: readonly Artifact[];
  at?: string;
}): SimulationReport['userSimulation'] {
  const at = input.at ?? new Date().toISOString();
  const artifacts = input.artifacts;
  const pages = artifacts.filter((a) => a.type === 'PAGE');
  const roles = artifacts.filter((a) => a.type === 'PERMISSION' || a.type === 'WORKFLOW');
  const findings: SimulationFinding[] = [];

  const push = (
    persona: UserPersona['key'],
    dimension: string,
    severity: SimulationSeverity,
    subject: string,
    detail: string,
    examined: readonly string[],
  ): void => {
    findings.push(
      Object.freeze({
        id: findingId(input.projectId, 'user-simulation', dimension, subject),
        simulation: 'user-simulation' as const,
        persona,
        dimension,
        subject,
        severity,
        detail,
        examinedArtifactIds: Object.freeze([...examined]),
        at,
      }),
    );
  };

  if (pages.length === 0) {
    for (const persona of USER_PERSONAS) {
      push(
        persona.key,
        'entry-point',
        'not-applicable',
        'pages',
        'This project has no certified page inventory, so no persona can be exercised against a real surface yet.',
        [],
      );
    }
    return Object.freeze(findings);
  }

  const pageIds = pages.map((p) => p.id);

  for (const persona of USER_PERSONAS) {
    switch (persona.key) {
      case 'new-user': {
        const withEmpty = pages.filter((p) => hasLayer(p, 'States') || hasLayer(p, 'states'));
        if (withEmpty.length === 0) {
          push(persona.key, 'first-run', 'defect', 'states', 'A new user meets every surface with no defined state inventory, so there is no empty or first-run experience for anyone.', pageIds);
        } else {
          push(persona.key, 'first-run', 'observation', 'states', `${withEmpty.length} of ${pages.length} certified pages define a state inventory, which is the substrate a first-run experience must be built from.`, withEmpty.map((p) => p.id));
        }
        break;
      }
      case 'experienced-user': {
        const withActions = pages.filter((p) => hasLayer(p, 'Interactions') || hasLayer(p, 'interactions'));
        if (withActions.length === 0) {
          push(persona.key, 'efficiency', 'defect', 'interactions', 'No certified page defines an interaction inventory, so no efficiency path (bulk actions, shortcuts, filters) exists for an experienced user.', pageIds);
        } else {
          push(persona.key, 'efficiency', 'observation', 'interactions', `${withActions.length} certified page(s) define interactions that an experienced-user path can be evaluated against.`, withActions.map((p) => p.id));
        }
        break;
      }
      case 'mobile-user':
      case 'tablet-user': {
        const responsive = pages.filter((p) => hasLayer(p, 'Responsive') || hasLayer(p, 'responsive'));
        if (responsive.length < pages.length) {
          push(
            persona.key,
            'responsive',
            'defect',
            'responsive-coverage',
            `${pages.length - responsive.length} of ${pages.length} certified pages have no responsive specification; this persona has no defined experience on them.`,
            pages.filter((p) => !responsive.includes(p)).map((p) => p.id),
          );
        } else {
          push(persona.key, 'responsive', 'observation', 'responsive-coverage', 'Every certified page defines responsive behavior for this form factor.', pageIds);
        }
        break;
      }
      case 'accessibility-oriented-user': {
        const a11y = artifacts.filter((a) => a.type === 'A11Y');
        if (a11y.length === 0) {
          push(persona.key, 'accessibility', 'defect', 'a11y-inventory', 'No certified accessibility requirement exists, so keyboard and screen-reader behavior is undefined for every surface.', pageIds);
        } else {
          const covered = new Set(a11y.map((a) => a.dependencies[0]).filter((d): d is string => d !== undefined));
          const uncovered = pages.filter((p) => !covered.has(p.id));
          if (uncovered.length > 0) {
            push(persona.key, 'accessibility', 'defect', 'a11y-coverage', `${uncovered.length} certified page(s) have no accessibility requirement bound to them.`, uncovered.map((p) => p.id));
          } else {
            push(persona.key, 'accessibility', 'observation', 'a11y-coverage', `All ${pages.length} certified pages have a bound accessibility requirement.`, a11y.map((a) => a.id));
          }
        }
        break;
      }
      case 'slow-network-user': {
        const asyncPages = pages.filter((p) => hasLayer(p, 'States') || hasLayer(p, 'states'));
        if (asyncPages.length === 0) {
          push(persona.key, 'latency', 'defect', 'loading-state', 'No certified page defines a state inventory, so no loading, timeout or degraded experience exists for a slow network.', pageIds);
        } else {
          push(persona.key, 'latency', 'observation', 'loading-state', `${asyncPages.length} certified page(s) define a state inventory, which is where latency and degraded behavior must be specified.`, asyncPages.map((p) => p.id));
        }
        break;
      }
      case 'error-prone-user': {
        const validations = artifacts.filter((a) => a.type === 'VALIDATION');
        const actions = artifacts.filter((a) => a.type === 'ACTION');
        if (actions.length > 0 && validations.length === 0) {
          push(persona.key, 'error-recovery', 'defect', 'validations', `${actions.length} certified action(s) exist with no validation requirement anywhere; bad input, double submits and stale forms are undefined.`, artifactIds(artifacts, 'ACTION'));
        } else {
          push(persona.key, 'error-recovery', 'observation', 'validations', `${validations.length} certified validation requirement(s) exist against ${actions.length} action(s).`, validations.map((v) => v.id));
        }
        break;
      }
    }
  }

  if (roles.length === 0) {
    push('new-user', 'onboarding', 'defect', 'role-coverage', 'No certified workflow or permission exists, so no persona can be checked against any authorization boundary.', []);
  }

  return Object.freeze(findings);
}

// ── §110 adversarial product simulation ──────────────────────────────────────

/** Every dimension §110 requires the adversarial pass to attack. */
export const ADVERSARIAL_DIMENSIONS = [
  'workflows',
  'permissions',
  'navigation',
  'business-rules',
  'data-consistency',
  'ui-states',
  'accessibility',
  'performance',
  'security',
  'integrations',
  'recovery',
  'edge-cases',
] as const;

export type AdversarialDimension = (typeof ADVERSARIAL_DIMENSIONS)[number];

/**
 * Attacks the certified inventory across every §110 dimension. Each attack
 * looks for the specific structural contradiction or gap that would let the
 * product be wrong, and reports the exact artifacts it inspected. It never
 * assumes a defect exists: a dimension whose subject inventory is genuinely
 * empty is reported as not-applicable with the reason.
 */
export function runAdversarialSimulation(input: {
  projectId: string;
  artifacts: readonly Artifact[];
  at?: string;
}): SimulationReport['adversarialSimulation'] {
  const at = input.at ?? new Date().toISOString();
  const artifacts = input.artifacts;
  const findings: SimulationFinding[] = [];

  const push = (
    dimension: AdversarialDimension,
    severity: SimulationSeverity,
    subject: string,
    detail: string,
    examined: readonly string[],
  ): void => {
    findings.push(
      Object.freeze({
        id: findingId(input.projectId, 'adversarial-simulation', dimension, subject),
        simulation: 'adversarial-simulation' as const,
        dimension,
        subject,
        severity,
        detail,
        examinedArtifactIds: Object.freeze([...examined]),
        at,
      }),
    );
  };

  const byType = (type: string): Artifact[] => artifacts.filter((a) => a.type === type);
  const pages = byType('PAGE');
  const entities = byType('ENTITY');
  const apis = byType('API');
  const permissions = byType('PERMISSION');
  const rules = byType('RULE');
  const secReqs = byType('SEC_REQ');
  const integrations = byType('INTEGRATION');
  const perfReqs = byType('PERF');
  const states = byType('STATE');
  const a11y = byType('A11Y');
  const workflows = byType('WORKFLOW');

  // Workflows: a feature with no workflow cannot be exercised end to end.
  {
    const features = byType('FEATURE');
    if (features.length > 0 && workflows.length === 0) {
      push('workflows', 'defect', 'feature-without-workflow', `${features.length} certified feature(s) exist with no workflow anywhere; no end-to-end path can be proven for any of them.`, features.map((f) => f.id));
    } else if (features.length === 0) {
      push('workflows', 'not-applicable', 'no-features', 'No certified feature inventory exists, so the workflow attack has no subject in this project yet.', []);
    } else {
      push('workflows', 'observation', 'workflow-coverage', `${workflows.length} certified workflow(s) exist across ${features.length} feature(s).`, workflows.map((w) => w.id));
    }
  }

  // Permissions: an action nobody is permitted is silently open to everyone.
  {
    const actions = byType('ACTION');
    if (actions.length > 0 && permissions.length === 0) {
      push('permissions', 'defect', 'unmapped-actions', `${actions.length} certified action(s) have no permission mapping at all; every action is effectively open to every role.`, actions.map((a) => a.id));
    } else if (actions.length === 0) {
      push('permissions', 'not-applicable', 'no-actions', 'No certified action inventory exists yet.', []);
    } else {
      push('permissions', 'observation', 'permission-coverage', `${permissions.length} permission requirement(s) govern ${actions.length} action(s).`, permissions.map((p) => p.id));
    }
  }

  // Navigation: pages that are not reachable from any role or entry point.
  {
    if (pages.length > 0) {
      const orphans = pages.filter((p) => (p.attributes['requiredBy'] === undefined) && p.dependencies.length === 0);
      if (orphans.length > 0) {
        push('navigation', 'defect', 'orphan-pages', `${orphans.length} certified page(s) declare no requiring role, feature, or upstream link and are therefore unreachable by any user.`, orphans.map((p) => p.id));
      } else {
        push('navigation', 'observation', 'page-attribution', `All ${pages.length} certified page(s) declare a requiring parent or upstream dependency.`, pages.map((p) => p.id));
      }
    } else {
      push('navigation', 'not-applicable', 'no-pages', 'No certified page inventory exists yet.', []);
    }
  }

  // Business rules: rules with no artifact to govern.
  {
    if (rules.length > 0) {
      const ungoverned = rules.filter((r) => r.dependencies.length === 0);
      if (ungoverned.length > 0) {
        push('business-rules', 'defect', 'ungoverned-rules', `${ungoverned.length} business rule(s) govern no action, state or entity, so their effect on the product cannot be proven.`, ungoverned.map((r) => r.id));
      } else {
        push('business-rules', 'observation', 'rule-attachment', `All ${rules.length} business rule(s) are attached to at least one artifact.`, rules.map((r) => r.id));
      }
    } else {
      push('business-rules', 'not-applicable', 'no-rules', 'No certified business rule exists yet.', []);
    }
  }

  // Data consistency: an entity with no API surface cannot be read or written.
  {
    if (entities.length > 0) {
      const apiEntities = new Set(apis.flatMap((a) => a.dependencies));
      const unreachable = entities.filter((e) => !apiEntities.has(e.id));
      if (unreachable.length > 0) {
        push('data-consistency', 'defect', 'entities-without-api', `${unreachable.length} certified entit(ies) have no API artifact operating on them; no read or write path exists.`, unreachable.map((e) => e.id));
      } else {
        push('data-consistency', 'observation', 'entity-api-coverage', `All ${entities.length} certified entit(ies) are operated on by at least one API.`, entities.map((e) => e.id));
      }
    } else {
      push('data-consistency', 'not-applicable', 'no-entities', 'No certified entity inventory exists yet.', []);
    }
  }

  // UI states: states that no action or condition can produce.
  {
    if (states.length > 0) {
      const unreachable = states.filter((s) => s.dependencies.length === 0);
      if (unreachable.length > 0) {
        push('ui-states', 'defect', 'unreachable-states', `${unreachable.length} certified state(s) name no triggering action or condition, so the product can never enter them.`, unreachable.map((s) => s.id));
      } else {
        push('ui-states', 'observation', 'state-reachability', `All ${states.length} certified state(s) name a triggering condition.`, states.map((s) => s.id));
      }
    } else {
      push('ui-states', 'not-applicable', 'no-states', 'No certified state inventory exists yet.', []);
    }
  }

  // Accessibility / performance / security / integrations: presence plus coverage.
  const coverageAttack = (
    dimension: AdversarialDimension,
    type: 'A11Y' | 'PERF' | 'SEC_REQ' | 'INTEGRATION',
    human: string,
  ): void => {
    const reqs = byType(type);
    if (pages.length === 0) {
      push(dimension, 'not-applicable', 'no-pages', `No certified page inventory exists, so ${human} coverage cannot be attacked yet.`, []);
      return;
    }
    if (reqs.length === 0) {
      push(dimension, 'defect', 'no-requirements', `No ${human} requirement exists for a product that has ${pages.length} certified page(s).`, pages.map((p) => p.id));
      return;
    }
    const covered = new Set(reqs.map((r) => r.dependencies[0]).filter((d): d is string => d !== undefined));
    const uncovered = pages.filter((p) => !covered.has(p.id));
    if (uncovered.length > 0) {
      push(dimension, 'defect', 'coverage-gap', `${uncovered.length} certified page(s) have no ${human} requirement bound to them.`, uncovered.map((p) => p.id));
    } else {
      push(dimension, 'observation', 'full-coverage', `All ${pages.length} certified page(s) have a bound ${human} requirement.`, reqs.map((r) => r.id));
    }
  };
  coverageAttack('accessibility', 'A11Y', 'accessibility');
  coverageAttack('performance', 'PERF', 'performance');
  coverageAttack('security', 'SEC_REQ', 'security');
  coverageAttack('integrations', 'INTEGRATION', 'integration');

  // Recovery: a product with no recovery requirement has no defined failure path.
  {
    const recoveryPages = pages.filter((p) => hasLayer(p, 'Recovery') || hasLayer(p, 'recovery'));
    if (pages.length > 0 && recoveryPages.length < pages.length) {
      push('recovery', 'defect', 'recovery-gap', `${pages.length - recoveryPages.length} certified page(s) have no recovery layer; interruption, retry and rollback are undefined for them.`, pages.filter((p) => !recoveryPages.includes(p)).map((p) => p.id));
    } else if (pages.length === 0) {
      push('recovery', 'not-applicable', 'no-pages', 'No certified page inventory exists yet.', []);
    } else {
      push('recovery', 'observation', 'recovery-coverage', 'Every certified page defines a recovery layer.', pageIds(pages));
    }
  }

  // Edge cases: entities/APIs with no edge-case or failure coverage.
  {
    const edgeCases = artifacts.filter((a) => a.type === 'FINDING' || a.type === 'RISK');
    if (entities.length > 0 && edgeCases.length === 0) {
      push('edge-cases', 'defect', 'no-edge-case-register', `${entities.length} certified entit(ies) exist with no recorded edge case or risk finding; failure and abuse conditions are unreviewed.`, entities.map((e) => e.id));
    } else if (entities.length === 0) {
      push('edge-cases', 'not-applicable', 'no-entities', 'No certified entity inventory exists yet.', []);
    } else {
      push('edge-cases', 'observation', 'edge-case-register', `${edgeCases.length} edge-case or risk finding(s) are recorded against the entity inventory.`, edgeCases.map((e) => e.id));
    }
  }

  void apis;
  void secReqs;
  void perfReqs;
  void a11y;
  void permissions;
  return Object.freeze(findings);
}

function pageIds(pages: readonly Artifact[]): readonly string[] {
  return pages.map((p) => p.id);
}

/** Runs both simulations and rolls them into one report. */
export function runProductSimulations(input: {
  projectId: string;
  artifacts: readonly Artifact[];
  at?: string;
}): SimulationReport {
  const at = input.at ?? new Date().toISOString();
  const userSimulation = runUserSimulation({ ...input, at });
  const adversarialSimulation = runAdversarialSimulation({ ...input, at });
  const all = [...userSimulation, ...adversarialSimulation];
  const defects = all.filter((f) => f.severity === 'defect').length;
  const observations = all.filter((f) => f.severity === 'observation').length;
  const notApplicable = all.filter((f) => f.severity === 'not-applicable').length;
  const summary =
    `Real user simulation raised ${userSimulation.filter((f) => f.severity === 'defect').length} defect(s) and ` +
    `${userSimulation.filter((f) => f.severity === 'observation').length} observation(s) across ${USER_PERSONAS.length} representative personas; ` +
    `adversarial simulation raised ${adversarialSimulation.filter((f) => f.severity === 'defect').length} defect(s) across ${ADVERSARIAL_DIMENSIONS.length} attack dimensions. ` +
    `${notApplicable} check(s) were not applicable to this project's certified inventory. ` +
    'These findings are inputs to final certification; they do not certify anything themselves.';
  return Object.freeze({
    projectId: input.projectId,
    generatedAt: at,
    userSimulation,
    adversarialSimulation,
    defects,
    observations,
    notApplicable,
    summary,
  });
}
