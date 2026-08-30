/**
 * Security threat modeling and requirements derivation (Increment 5).
 *
 * Derives STRIDE threat model and security requirements from the business
 * capability model (roles, permissions, entities, workflows).
 */
import type { CoreServices } from '../core/services.ts';
import type { Actor } from '../core/artifact.ts';
import { createArtifact } from '../core/artifact.ts';
import { syncArtifactToGraph } from '../core/graph.ts';
import type { BusinessModel } from '../discovery/business-model.ts';

export type StrideCategory = 'spoofing' | 'tampering' | 'repudiation' | 'information-disclosure' | 'denial-of-service' | 'elevation-of-privilege';

export interface Threat {
  readonly id: string;
  readonly category: StrideCategory;
  readonly title: string;
  readonly description: string;
  readonly asset: string;
  readonly impact: 'low' | 'medium' | 'high';
  readonly likelihood: 'low' | 'medium' | 'high';
  readonly mitigations: readonly string[];
}

export interface SecurityRequirement {
  readonly id: string;
  readonly category: 'authentication' | 'authorization' | 'data-protection' | 'audit' | 'compliance';
  readonly title: string;
  readonly description: string;
  readonly threatIds: readonly string[];
  readonly priority: 'P0' | 'P1' | 'P2';
}

export interface ThreatModel {
  readonly projectId: string;
  readonly threats: readonly Threat[];
  readonly securityRequirements: readonly SecurityRequirement[];
  readonly generatedAt: string;
}

const STRIDE_CATEGORIES: readonly StrideCategory[] = [
  'spoofing', 'tampering', 'repudiation', 'information-disclosure', 'denial-of-service', 'elevation-of-privilege',
];

function generateThreats(model: BusinessModel): Threat[] {
  const threats: Threat[] = [];
  let threatCounter = 0;

  const addThreat = (
    category: StrideCategory,
    title: string,
    description: string,
    asset: string,
    impact: 'low' | 'medium' | 'high',
    likelihood: 'low' | 'medium' | 'high',
    mitigations: string[],
  ) => {
    threats.push({
      id: `THREAT-${String(++threatCounter).padStart(3, '0')}`,
      category,
      title,
      description,
      asset,
      impact,
      likelihood,
      mitigations,
    });
  };

  // Spoofing: identity/authentication threats
  if (model.roles.length > 0) {
    addThreat(
      'spoofing',
      'User impersonation via stolen credentials',
      'Attacker obtains valid credentials and impersonates a legitimate user.',
      'Authentication system',
      'high',
      'medium',
      ['MFA enforcement', 'Credential rotation', 'Anomalous login detection'],
    );
    addThreat(
      'spoofing',
      'Service-to-service impersonation',
      'Compromised service token used to call internal APIs.',
      'Internal API communication',
      'high',
      'low',
      ['mTLS', 'Short-lived tokens', 'Service mesh'],
    );
  }

  // Tampering: data integrity threats
  for (const entity of model.entities) {
    addThreat(
      'tampering',
      `Unauthorized modification of ${entity.name} data`,
      `Attacker modifies ${entity.name} records without authorization.`,
      `Entity: ${entity.name}`,
      'high',
      'medium',
      ['Input validation', 'Database constraints', 'Audit logging', 'WAF rules'],
    );
  }
  if (model.workflows.length > 0) {
    addThreat(
      'tampering',
      'Workflow state manipulation',
      'Attacker bypasses workflow steps or modifies state transitions.',
      'Workflow engine',
      'high',
      'low',
      ['State machine validation', 'Server-side enforcement', 'Immutable event log'],
    );
  }

  // Repudiation: non-repudiation threats
  addThreat(
    'repudiation',
    'Critical action without audit trail',
    'User performs sensitive operation (delete, permission change) without logged evidence.',
    'Audit log',
    'high',
    'medium',
    ['Immutable audit log', 'Signed audit entries', 'Tamper-evident storage'],
  );

  // Information Disclosure: data exposure threats
  for (const entity of model.entities) {
    const hasSensitive = entity.fields.some((f) =>
      ['email', 'password', 'ssn', 'credit', 'token', 'secret', 'key', 'pii'].some((s) =>
        f.name.toLowerCase().includes(s),
      ),
    );
    if (hasSensitive || entity.requiredFields.length > 0) {
      addThreat(
        'information-disclosure',
        `Exposure of ${entity.name} sensitive fields`,
        `Sensitive data in ${entity.name} accessible via unauthorized query or log leakage.`,
        `Entity: ${entity.name}`,
        'high',
        'medium',
        ['Field-level encryption', 'Data minimization in logs', 'Access control on queries', 'DLP scanning'],
      );
    }
  }
  if (model.adminCapabilities.length > 0) {
    addThreat(
      'information-disclosure',
      'Admin panel data exposure',
      'Administrative interfaces expose more data than necessary for the task.',
      'Admin UI / API',
      'medium',
      'medium',
      ['Principle of least privilege', 'Scoped admin APIs', 'UI data filtering'],
    );
  }

  // Denial of Service: availability threats
  addThreat(
    'denial-of-service',
    'API endpoint exhaustion',
    'High-volume requests to critical endpoints degrade service availability.',
    'Public API endpoints',
    'medium',
    'high',
    ['Rate limiting', 'Request queuing', 'Auto-scaling', 'Circuit breakers'],
  );
  if (model.workflows.length > 0) {
    addThreat(
      'denial-of-service',
      'Workflow queue flooding',
      'Malicious workflow initiation exhausts processing capacity.',
      'Workflow engine',
      'medium',
      'low',
      ['Per-user workflow quotas', 'Async processing with backpressure', 'Priority queuing'],
    );
  }

  // Elevation of Privilege: authorization bypass threats
  for (const admin of model.adminCapabilities) {
    addThreat(
      'elevation-of-privilege',
      `Privilege escalation via ${admin.role} role`,
      `Attacker gains ${admin.role} permissions and accesses admin-only resources.`,
      `Role: ${admin.role}`,
      'high',
      'low',
      ['Role separation', 'Break-glass procedures', 'Privileged access management', 'Regular access reviews'],
    );
  }
  if (model.rolePermissions.length > 0) {
    addThreat(
      'elevation-of-privilege',
      'Horizontal privilege escalation',
      'User accesses resources of another user at same role level.',
      'Multi-tenant data access',
      'high',
      'medium',
      ['Row-level security', 'Tenant isolation', 'Resource ownership checks'],
    );
  }

  return threats;
}

function generateSecurityRequirements(model: BusinessModel, threats: readonly Threat[]): SecurityRequirement[] {
  const requirements: SecurityRequirement[] = [];
  let reqCounter = 0;

  const addReq = (
    category: SecurityRequirement['category'],
    title: string,
    description: string,
    threatIds: string[],
    priority: 'P0' | 'P1' | 'P2',
  ) => {
    requirements.push({
      id: `SEC-REQ-${String(++reqCounter).padStart(3, '0')}`,
      category,
      title,
      description,
      threatIds,
      priority,
    });
  };

  // Authentication requirements
  addReq(
    'authentication',
    'Multi-factor authentication for all human users',
    'Enforce MFA for all interactive login flows, with fallback for service accounts.',
    threats.filter((t) => t.category === 'spoofing').map((t) => t.id),
    'P0',
  );
  addReq(
    'authentication',
    'Short-lived tokens with automatic rotation',
    'Access tokens expire within 15 minutes; refresh tokens rotate on use.',
    threats.filter((t) => t.category === 'spoofing').map((t) => t.id),
    'P0',
  );

  // Authorization requirements
  addReq(
    'authorization',
    'Role-based access control with least privilege',
    'Permissions granted per role; default-deny; admin roles require break-glass.',
    threats
      .filter((t) => t.category === 'elevation-of-privilege')
      .map((t) => t.id),
    'P0',
  );
  addReq(
    'authorization',
    'Resource-level authorization checks',
    'Every API endpoint verifies caller has permission on the specific resource instance.',
    threats
      .filter((t) => t.category === 'elevation-of-privilege')
      .map((t) => t.id),
    'P0',
  );

  // Data Protection requirements
  for (const entity of model.entities) {
    const sensitive = entity.fields.some((f) =>
      ['email', 'password', 'ssn', 'credit', 'token', 'secret', 'key', 'pii'].some((s) =>
        f.name.toLowerCase().includes(s),
      ),
    );
    if (sensitive) {
      addReq(
        'data-protection',
        `Encryption at rest for ${entity.name} sensitive fields`,
        `Sensitive fields in ${entity.name} encrypted with AES-256; keys managed by KMS.`,
        threats
          .filter((t) => t.category === 'information-disclosure' && t.asset.includes(entity.name))
          .map((t) => t.id),
        'P0',
      );
    }
  }
  addReq(
    'data-protection',
    'TLS 1.3 for all external and internal communication',
    'All network traffic encrypted; mTLS for service-to-service.',
    threats
      .filter((t) => t.category === 'information-disclosure' || t.category === 'tampering')
      .map((t) => t.id),
    'P0',
  );

  // Audit requirements
  addReq(
    'audit',
    'Immutable audit log for all state-changing operations',
    'Every write operation produces a signed, append-only audit entry with actor, action, resource, timestamp.',
    threats.filter((t) => t.category === 'repudiation').map((t) => t.id),
    'P0',
  );
  addReq(
    'audit',
    'Admin action logging with enhanced detail',
    'Administrative operations log full request context, justification, and approver.',
    threats
      .filter((t) => t.category === 'repudiation' || (t.category === 'elevation-of-privilege' && t.title.includes('admin')))
      .map((t) => t.id),
    'P1',
  );

  // Compliance placeholder
  addReq(
    'compliance',
    'Data retention and deletion policy enforcement',
    'Automated enforcement of retention schedules per entity; right-to-delete workflow.',
    threats
      .filter((t) => t.category === 'information-disclosure')
      .map((t) => t.id),
    'P2',
  );

  return requirements;
}

export async function deriveThreatModel(
  services: CoreServices,
  model: BusinessModel,
  actor: Actor,
): Promise<ThreatModel> {
  const threats = generateThreats(model);
  const securityRequirements = generateSecurityRequirements(model, threats);

  // Persist threat model as artifact
  const at = new Date().toISOString();
  const artifact = createArtifact({
    id: services.allocator.nextId('THREAT_MODEL'),
    type: 'THREAT_MODEL',
    title: `Threat model for ${model.projectId}`,
    projectId: model.projectId,
    actor,
    at,
    dependencies: [],
    attributes: {
      threats,
      securityRequirements,
      generatedAt: at,
    },
  });
  await services.store.append(artifact);
  syncArtifactToGraph(services.graph, artifact);

  // Persist each threat and requirement as linked artifacts for traceability
  for (const threat of threats) {
    const tArtifact = createArtifact({
      id: services.allocator.nextId('THREAT'),
      type: 'THREAT',
      title: threat.title,
      projectId: model.projectId,
      actor,
      at,
      dependencies: [artifact.id],
      attributes: { ...threat },
    });
    await services.store.append(tArtifact);
    syncArtifactToGraph(services.graph, tArtifact);
    services.graph.link(artifact.id, 'CONTAINS', tArtifact.id);
  }
  for (const req of securityRequirements) {
    const rArtifact = createArtifact({
      id: services.allocator.nextId('SEC_REQ'),
      type: 'SEC_REQ',
      title: req.title,
      projectId: model.projectId,
      actor,
      at,
      dependencies: [artifact.id],
      attributes: { ...req },
    });
    await services.store.append(rArtifact);
    syncArtifactToGraph(services.graph, rArtifact);
    services.graph.link(artifact.id, 'CONTAINS', rArtifact.id);
  }

  return { projectId: model.projectId, threats, securityRequirements, generatedAt: at };
}