/**
 * Multi-Perspective Reasoning Council (spec §0.21) - Level 2.
 *
 * Independent judgment over a subject by genuinely different reasoning
 * perspectives. Independence is REAL, not labeled:
 *   - each seat is a SEPARATE AI call through the router with its own
 *     persona, analytical lens and output contract;
 *   - seats never see each other's responses (the engine passes only the
 *     subject to each call);
 *   - every seat is independently attributable (provider/model/sha256) and
 *     anchored in the evidence log;
 *   - the orchestrator RECONCILES disagreement deterministically rather than
 *     averaging it away (spec: the Executive Orchestrator reconciles).
 *
 * Council objections are first-class: they can block certification and are
 * logged like any other finding.
 */

import { createHash } from 'node:crypto';
import type { CoreServices } from '../core/services.ts';
import type { Actor } from '../core/artifact.ts';
import { createArtifact } from '../core/artifact.ts';
import { syncArtifactToGraph } from '../core/graph.ts';
import { DiscoveryParseError } from '../discovery/errors.ts';
import { isObj } from '../discovery/parse-util.ts';
import { extractJson } from '../discovery/prompt.ts';

export interface CouncilSeatDef {
  readonly id: string;
  readonly title: string;
  /** The analytical lens that makes this perspective genuinely different. */
  readonly lens: string;
}

/** §0.21 roster: all fifteen specialist perspectives specified by the
 *  authority, each with a distinct analytical lens. Every seat is a separate
 *  AI call; no seat ever sees another seat's response. */
export const COUNCIL_SEATS: readonly CouncilSeatDef[] = [
  {
    id: 'product-manager',
    title: 'Product Manager',
    lens:
      'product intent and scope: does the subject serve the stated users and ' +
      'vision without inventing or dropping scope?',
  },
  {
    id: 'business-analyst',
    title: 'Business Analyst',
    lens:
      'requirements completeness and traceability: are functional and ' +
      'non-functional requirements stated, bound to design, and conflict-free?',
  },
  {
    id: 'software-architect',
    title: 'Software Architect',
    lens:
      'structural coherence: dependency shape, feasibility, consistency of ' +
      'patterns across the inventory',
  },
  {
    id: 'ux-designer',
    title: 'UX Designer',
    lens:
      'user journeys and interaction consistency: navigation completeness, ' +
      'state handling, usability gaps',
  },
  {
    id: 'ui-designer',
    title: 'UI Designer',
    lens:
      'visual and design-system consistency: component reuse, wireframe-to-visual ' +
      'fidelity, accessibility-safe styling',
  },
  {
    id: 'backend-engineer',
    title: 'Backend Engineer',
    lens:
      'service and API implementation coherence: data flow, error handling, ' +
      'transaction boundaries, contracts',
  },
  {
    id: 'frontend-engineer',
    title: 'Frontend Engineer',
    lens:
      'client implementation coherence: component wiring, state management, ' +
      'loading/empty/error states',
  },
  {
    id: 'database-architect',
    title: 'Database Architect',
    lens:
      'data model coherence: entities, relationships, migrations, integrity ' +
      'constraints, query feasibility',
  },
  {
    id: 'security-architect',
    title: 'Security Architect',
    lens:
      'permission model coherence, destructive-action guards, data exposure ' +
      'and abuse paths',
  },
  {
    id: 'performance-engineer',
    title: 'Performance Engineer',
    lens:
      'scalability and performance: caching, virtualization, async/background ' +
      'work, failure under load',
  },
  {
    id: 'devops-engineer',
    title: 'DevOps Engineer',
    lens:
      'delivery and operations coherence: deployment units, monitoring, ' +
      'rollback paths, environment parity',
  },
  {
    id: 'qa-engineer',
    title: 'QA Engineer',
    lens:
      'verification gaps: what is untestable, unspecified, or missing an ' +
      'error/success path',
  },
  {
    id: 'accessibility-specialist',
    title: 'Accessibility Specialist',
    lens:
      'accessibility completeness: keyboard, screen-reader, contrast, ' +
      'focus management, reduced-motion',
  },
  {
    id: 'compliance-specialist',
    title: 'Compliance Specialist',
    lens:
      'regulatory and compliance coverage: records, retention, privacy, ' +
      'data-handling obligations',
  },
  {
    id: 'domain-expert',
    title: 'Domain Expert',
    lens:
      'domain fidelity: business rules, terminology, real-world semantics of ' +
      'the product, edge cases a generalist would miss',
  },
];

export const COUNCIL_MARKER = '[COUNCIL]';
export function seatMarker(seatId: string): string {
  return `${COUNCIL_MARKER}[${seatId}]`;
}

export type CouncilStance = 'endorse' | 'concern' | 'object';
export type FindingSeverity = 'note' | 'concern' | 'objection';

export interface CouncilFinding {
  readonly seatId: string;
  readonly severity: FindingSeverity;
  readonly statement: string;
  /** Artifact IDs this finding concerns, when applicable. */
  readonly artifactIds: readonly string[];
}

export interface SeatRecord {
  readonly seatId: string;
  readonly title: string;
  readonly stance: CouncilStance;
  readonly findings: readonly CouncilFinding[];
  readonly uncertainties: readonly string[];
  readonly providerId: string;
  readonly modelId: string;
  readonly responseSha256: string;
  readonly evidenceId?: string;
}

export type CouncilVerdict = 'endorsed' | 'endorsed-with-concerns' | 'objected';

export interface CouncilDeliberation {
  readonly subject: string;
  readonly seats: readonly SeatRecord[];
  readonly verdict: CouncilVerdict;
  readonly objections: readonly CouncilFinding[];
  readonly concerns: readonly CouncilFinding[];
}

/** Validates one seat's structured response. */
export function parseSeatResponse(seatId: string, value: unknown): {
  stance: CouncilStance;
  findings: { severity: FindingSeverity; statement: string; artifactIds: readonly string[] }[];
  uncertainties: readonly string[];
} {
  const problems: string[] = [];
  if (!isObj(value)) problems.push('response is not a JSON object.');
  const stances: readonly string[] = ['endorse', 'concern', 'object'];
  const stance = isObj(value) ? value['stance'] : undefined;
  if (typeof stance !== 'string' || !stances.includes(stance)) {
    problems.push(`stance must be one of ${stances.join('|')}.`);
  }
  const severities: readonly string[] = ['note', 'concern', 'objection'];
  const rawFindings = isObj(value) ? value['findings'] : undefined;
  const findings: { severity: FindingSeverity; statement: string; artifactIds: readonly string[] }[] = [];
  if (rawFindings !== undefined) {
    if (!Array.isArray(rawFindings)) {
      problems.push('findings must be an array when present.');
    } else {
      rawFindings.forEach((entry, i) => {
        const label = `findings[${i}]`;
        if (!isObj(entry)) {
          problems.push(`${label}: must be an object.`);
          return;
        }
        const severity = entry['severity'];
        const statement = entry['statement'];
        if (typeof severity !== 'string' || !severities.includes(severity)) {
          problems.push(`${label}.severity must be one of ${severities.join('|')}.`);
        }
        if (typeof statement !== 'string' || statement.trim() === '') {
          problems.push(`${label}.statement: required non-empty string.`);
        }
        const artifactIds = entry['artifactIds'];
        if (
          artifactIds !== undefined &&
          (!Array.isArray(artifactIds) || !artifactIds.every((x) => typeof x === 'string'))
        ) {
          problems.push(`${label}.artifactIds: must be an array of strings when present.`);
        }
        if (typeof severity === 'string' && typeof statement === 'string') {
          findings.push({
            severity: severity as FindingSeverity,
            statement,
            artifactIds: Array.isArray(artifactIds)
              ? (artifactIds as string[]).filter((x) => typeof x === 'string')
              : [],
          });
        }
      });
    }
  }
  const rawUncertainties = isObj(value) ? value['uncertainties'] : undefined;
  let uncertainties: readonly string[] = [];
  if (rawUncertainties !== undefined) {
    if (!Array.isArray(rawUncertainties) || !rawUncertainties.every((x) => typeof x === 'string')) {
      problems.push('uncertainties: must be an array of strings when present.');
    } else {
      uncertainties = rawUncertainties as string[];
    }
  }
  if (problems.length > 0) {
    throw new DiscoveryParseError(
      problems.map((p) => `council seat ${seatId}: ${p}`),
    );
  }
  return { stance: stance as CouncilStance, findings, uncertainties };
}

/** Deterministic reconciliation - disagreement is surfaced, never averaged. */
export function reconcile(
  subject: string,
  seats: readonly SeatRecord[],
): CouncilDeliberation {
  const allFindings: CouncilFinding[] = seats.flatMap((seat) =>
    seat.findings.map((f) => ({ ...f, seatId: seat.seatId })),
  );
  const objections = allFindings.filter((f) => f.severity === 'objection');
  const concerns = allFindings.filter((f) => f.severity === 'concern');
  const objected = seats.some((s) => s.stance === 'object') || objections.length > 0;
  const concerned =
    seats.some((s) => s.stance === 'concern') || concerns.length > 0;
  return {
    subject,
    seats,
    verdict: objected ? 'objected' : concerned ? 'endorsed-with-concerns' : 'endorsed',
    objections,
    concerns,
  };
}

export interface DeliberationInput {
  /** What is being judged, e.g. "BLUEPRINT-0001 completeness". */
  readonly subject: string;
  /** The precise question every perspective answers independently. */
  readonly question: string;
  /** A factual summary of the subject (no other seat's output, ever). */
  readonly contextSummary: string;
  /** Artifact IDs the deliberation concerns (evidence anchoring). */
  readonly artifactIds?: readonly string[];
  /** Project context. Omitted/deduced from the first artifactId when absent. */
  readonly projectId?: string;
}

/**
 * Materializes a Council finding that identifies a missing or incorrect
 * artifact as an addressable FINDING artifact (spec §0.21: same artifact-ID
 * and metadata discipline as a Red Team finding or Boss-reconstruction delta).
 * Findings without an artifact target remain anchored in the seat evidence
 * log only - they name no artifact and have nothing to materialize.
 */
async function materializeCouncilFinding(
  services: CoreServices,
  input: { readonly subject: string; readonly projectId?: string },
  seat: SeatRecord,
  finding: CouncilFinding,
): Promise<void> {
  const targets = [...new Set(finding.artifactIds.filter((id) => id !== seat.seatId))];
  if (targets.length === 0) return;
  let projectId = input.projectId;
  if (projectId === undefined) {
    const firstId = targets[0];
    if (firstId !== undefined) {
      const first = await services.store.get(firstId);
      if (first?.projectId !== null && first?.projectId !== undefined) projectId = first.projectId;
    }
  }
  const producer: Actor = { kind: 'ai', id: seat.providerId, modelId: seat.modelId };
  const id = services.allocator.nextId('FINDING');
  const findingArtifact = createArtifact({
    id,
    type: 'FINDING',
    title: `Council ${seat.title} ${finding.severity}: ${finding.statement.slice(0, 72)}`,
    description: finding.statement,
    projectId,
    actor: producer,
    dependencies: targets,
    attributes: {
      findingKind: 'council-finding',
      seatId: seat.seatId,
      severity: finding.severity,
      subject: input.subject,
      statement: finding.statement,
      artifactIds: targets,
      evidenceId: seat.evidenceId,
    },
  });
  await services.store.append(findingArtifact);
  await services.evidence.append({
    kind: 'inspection',
    summary:
      `Council seat ${seat.seatId} materialized finding ${id} ` +
      `(${finding.severity}) over ${targets.join(', ')}.`,
    artifactIds: [id],
    producer,
  });
  syncArtifactToGraph(services.graph, findingArtifact);
}

export class ReasoningCouncil {
  readonly descriptor = {
    name: 'ReasoningCouncil',
    targetLevel: '2',
    status: 'implemented' as const,
  };

  private readonly services: CoreServices;

  constructor(services: CoreServices) {
    this.services = services;
  }

  /**
   * Runs every seat as an independent call. Seats are executed sequentially
   * and each receives ONLY (question + contextSummary): no seat ever sees
   * another seat's reasoning, which is what makes the perspectives real.
   */
  async deliberate(input: DeliberationInput): Promise<CouncilDeliberation> {
    const seats: SeatRecord[] = [];
    for (const seat of COUNCIL_SEATS) {
      const response = await this.services.router.complete({
        taskType: 'REVIEW',
        messages: [
          {
            role: 'system',
            content:
              `${seatMarker(seat.id)} You are the Council's ${seat.title}. ` +
              `Your analytical lens: ${seat.lens} Judge ONLY through this lens; ` +
              'do not imitate other perspectives. You have not seen and must not ' +
              'imagine any other seat\'s response.',
          },
          {
            role: 'user',
            content:
              `${input.question}\n\nSubject: ${input.subject}\n\n${input.contextSummary}\n\n` +
              'Reply with ONLY a JSON object: {"stance":"endorse|concern|object", ' +
              '"findings":[{"severity":"note|concern|objection","statement":"...", "artifactIds":["..."]}], ' +
              '"uncertainties":["..."]}',
          },
        ],
        temperature: 0.3,
      });
      const parsed = parseSeatResponse(seat.id, extractJson(response.content));
      const responseSha256 = createHash('sha256').update(response.content).digest('hex');
      const evidence = await this.services.evidence.append({
        kind: 'external-response',
        summary:
          `Council seat ${seat.id} (${response.providerId}/${response.modelId}) stance=${parsed.stance} sha256=${responseSha256.slice(0, 16)}…`,
        artifactIds: input.artifactIds ?? [],
        payloadRef: `sha256:${responseSha256}`,
        producer: { kind: 'ai', id: response.providerId, modelId: response.modelId },
      });
      const record: SeatRecord = {
        seatId: seat.id,
        title: seat.title,
        stance: parsed.stance,
        findings: parsed.findings.map((f) => ({ ...f, seatId: seat.id })),
        uncertainties: parsed.uncertainties,
        providerId: response.providerId,
        modelId: response.modelId,
        responseSha256,
        evidenceId: evidence.id,
      };
      seats.push(record);
      // §0.21: findings naming specific artifacts are materialized with the
      // same artifact-ID/metadata discipline as every other department finding.
      for (const finding of record.findings) {
        if (finding.artifactIds.length === 0) continue;
        await materializeCouncilFinding(
          this.services,
          { subject: input.subject, projectId: input.projectId },
          record,
          finding,
        );
      }
      this.services.logger?.info('council.seat', {
        seatId: seat.id,
        stance: parsed.stance,
        findings: parsed.findings.length,
      });
    }
    return reconcile(input.subject, seats);
  }
}