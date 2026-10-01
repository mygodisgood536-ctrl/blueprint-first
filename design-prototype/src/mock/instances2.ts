export { fetchMock, classifyIngest } from './data'

export const mockArtifacts = [
  { id: 'art_001', type: 'PROJECT', title: 'Lumina Dashboard', status: 'RECORDED', version: 1, projectId: 'prj_lumina_8k2m', phase: 'DESIGN' },
  { id: 'art_002', type: 'FEATURE', title: 'Evidence Trace View', status: 'RECORDED', version: 2, projectId: 'prj_lumina_8k2m', phase: 'DESIGN' },
  { id: 'art_003', type: 'WORKFLOW', title: 'Blueprint Approval Flow', status: 'RECORDED', version: 1, projectId: 'prj_lumina_8k2m', phase: 'DESIGN' },
  { id: 'art_004', type: 'PAGE', title: 'Project Workspace', status: 'RECORDED', version: 3, projectId: 'prj_lumina_8k2m', phase: 'IMPL' },
  { id: 'art_005', type: 'API', title: 'Document Ingest Endpoint', status: 'RECORDED', version: 1, projectId: 'prj_aurora_3f7x', phase: 'IMPL' },
  { id: 'art_006', type: 'TEST', title: 'Ingest Classification Test', status: 'RECORDED', version: 1, projectId: 'prj_aurora_3f7x', phase: 'TEST' },
  { id: 'art_007', type: 'FINDING', title: 'Requirement gap in auth flow', status: 'OPEN', version: 1, projectId: 'prj_lumina_8k2m', phase: 'DESIGN' },
]

export const mockEvidence = [
  { id: 'ev_001', artifactId: 'art_001', type: 'source', summary: 'Vision document ingested and classified', recordedAt: '2026-09-01T10:05:00Z' },
  { id: 'ev_002', artifactId: 'art_002', type: 'decision', summary: 'Trace view placed in workspace for evidence depth', recordedAt: '2026-09-02T11:00:00Z' },
  { id: 'ev_003', artifactId: 'art_003', type: 'verification', summary: 'Approval flow verified against independence principle', recordedAt: '2026-09-03T09:30:00Z' },
  { id: 'ev_004', artifactId: 'art_007', type: 'finding', summary: 'Auth flow missing session-expiry handling', recordedAt: '2026-09-08T15:00:00Z' },
]

export const mockVerificationDimensions = [
  { id: 'COUNT', label: 'Count', state: 'passed' },
  { id: 'COVERAGE', label: 'Coverage', state: 'passed' },
  { id: 'IDENTITY', label: 'Identity', state: 'passed' },
  { id: 'CORRECTNESS', label: 'Correctness', state: 'passed' },
  { id: 'QUALITY', label: 'Quality', state: 'passed' },
  { id: 'TRACEABILITY', label: 'Traceability', state: 'failed', finding: '2 artifacts lack upstream evidence link' },
  { id: 'DEPENDENCY_INTEGRITY', label: 'Dependency Integrity', state: 'passed' },
  { id: 'DUPLICATION', label: 'Duplication', state: 'passed' },
  { id: 'CONFLICTS', label: 'Conflicts', state: 'inconclusive' },
  { id: 'CONSISTENCY', label: 'Consistency', state: 'passed' },
  { id: 'EVIDENCE_OF_WORK', label: 'Evidence of Work', state: 'passed' },
]

export const mockTests = [
  { id: 'test_001', name: 'Ingest classifies short input as inline', scope: 'Document classification', state: 'passed', lastRun: '2026-09-09T14:00:00Z' },
  { id: 'test_002', name: 'Ingest classifies 8000+ char input as document', scope: 'Document classification', state: 'passed', lastRun: '2026-09-09T14:00:00Z' },
  { id: 'test_003', name: 'Approval gate blocks unapproved blueprint', scope: 'Approval flow', state: 'passed', lastRun: '2026-09-08T10:00:00Z' },
  { id: 'test_004', name: 'Session expiry redirects to login', scope: 'Auth', state: 'failed', lastRun: '2026-09-10T08:00:00Z' },
  { id: 'test_005', name: 'Provider connection test on credential add', scope: 'Providers', state: 'queued', lastRun: '' },
]

export const mockSessions = [
  { id: 'ses_001', device: 'Chrome 130 on Windows 11', location: 'Lagos, NG', lastActive: '2026-09-10T08:32:00Z', current: true },
  { id: 'ses_002', device: 'Safari on iPhone 15', location: 'Lagos, NG', lastActive: '2026-09-09T20:00:00Z', current: false },
  { id: 'ses_003', device: 'Chrome 130 on macOS', location: 'London, UK', lastActive: '2026-09-07T15:00:00Z', current: false },
]

export const mockSecurityEvents = [
  { id: 'se_001', type: 'login', detail: 'Signed in from Chrome on Windows', timestamp: '2026-09-10T08:00:00Z' },
  { id: 'se_002', type: 'password_change', detail: 'Password changed', timestamp: '2026-08-20T10:00:00Z' },
  { id: 'se_003', type: 'totp_enroll', detail: 'Authenticator enrolled', timestamp: '2026-08-18T09:00:00Z' },
  { id: 'se_004', type: 'session_revoke', detail: 'Session on Chrome macOS revoked', timestamp: '2026-09-08T12:00:00Z' },
]

/* Production lineage (§25) — base artifacts traced through the six
   production phases: DESIGN → IMPL → TEST → DEPLOY → OPS → PERM. */

export const LINEAGE_PHASES = ['DESIGN', 'IMPL', 'TEST', 'DEPLOY', 'OPS', 'PERM'] as const

export const mockLineage: { baseId: string; baseType: string; baseTitle: string; phases: { phase: string; artifactId: string; status: string; recordedAt: string; evidenceCount: number }[] }[] = [
  {
    baseId: 'PAGE-0042', baseType: 'PAGE', baseTitle: 'Project Workspace',
    phases: [
      { phase: 'DESIGN', artifactId: 'PAGE-0042-DESIGN', status: 'RECORDED', recordedAt: '2026-09-02T09:00:00Z', evidenceCount: 4 },
      { phase: 'IMPL', artifactId: 'PAGE-0042-IMPL', status: 'RECORDED', recordedAt: '2026-09-05T14:20:00Z', evidenceCount: 3 },
      { phase: 'TEST', artifactId: 'PAGE-0042-TEST', status: 'RECORDED', recordedAt: '2026-09-07T10:45:00Z', evidenceCount: 2 },
      { phase: 'DEPLOY', artifactId: 'PAGE-0042-DEPLOY', status: 'RECORDED', recordedAt: '2026-09-08T16:00:00Z', evidenceCount: 2 },
      { phase: 'OPS', artifactId: 'PAGE-0042-OPS', status: 'PENDING', recordedAt: '', evidenceCount: 0 },
      { phase: 'PERM', artifactId: 'PAGE-0042-PERM', status: 'PENDING', recordedAt: '', evidenceCount: 0 },
    ],
  },
  {
    baseId: 'API-0011', baseType: 'API', baseTitle: 'Document Ingest Endpoint',
    phases: [
      { phase: 'DESIGN', artifactId: 'API-0011-DESIGN', status: 'RECORDED', recordedAt: '2026-09-01T11:30:00Z', evidenceCount: 3 },
      { phase: 'IMPL', artifactId: 'API-0011-IMPL', status: 'RECORDED', recordedAt: '2026-09-04T09:15:00Z', evidenceCount: 4 },
      { phase: 'TEST', artifactId: 'API-0011-TEST', status: 'RECORDED', recordedAt: '2026-09-06T13:40:00Z', evidenceCount: 2 },
      { phase: 'DEPLOY', artifactId: 'API-0011-DEPLOY', status: 'RECORDED', recordedAt: '2026-09-07T08:00:00Z', evidenceCount: 1 },
      { phase: 'OPS', artifactId: 'API-0011-OPS', status: 'RECORDED', recordedAt: '2026-09-09T12:10:00Z', evidenceCount: 1 },
      { phase: 'PERM', artifactId: 'API-0011-PERM', status: 'PENDING', recordedAt: '', evidenceCount: 0 },
    ],
  },
  {
    baseId: 'FEATURE-0007', baseType: 'FEATURE', baseTitle: 'Evidence Trace View',
    phases: [
      { phase: 'DESIGN', artifactId: 'FEATURE-0007-DESIGN', status: 'RECORDED', recordedAt: '2026-09-02T10:00:00Z', evidenceCount: 5 },
      { phase: 'IMPL', artifactId: 'FEATURE-0007-IMPL', status: 'RECORDED', recordedAt: '2026-09-05T15:00:00Z', evidenceCount: 3 },
      { phase: 'TEST', artifactId: 'FEATURE-0007-TEST', status: 'RECORDED', recordedAt: '2026-09-06T17:20:00Z', evidenceCount: 2 },
      { phase: 'DEPLOY', artifactId: 'FEATURE-0007-DEPLOY', status: 'PENDING', recordedAt: '', evidenceCount: 0 },
      { phase: 'OPS', artifactId: 'FEATURE-0007-OPS', status: 'PENDING', recordedAt: '', evidenceCount: 0 },
      { phase: 'PERM', artifactId: 'FEATURE-0007-PERM', status: 'PENDING', recordedAt: '', evidenceCount: 0 },
    ],
  },
]

/* Dependency map (§25) — nodes are artifacts; edges are dependencies.
   evidenceDepth drives node color/weight in the graph view. */

export const mockDependencyMap = {
  nodes: [
    { id: 'art_001', type: 'PROJECT', title: 'Lumina Dashboard', evidenceDepth: 4 },
    { id: 'art_002', type: 'FEATURE', title: 'Evidence Trace View', evidenceDepth: 3 },
    { id: 'art_003', type: 'WORKFLOW', title: 'Blueprint Approval Flow', evidenceDepth: 3 },
    { id: 'art_004', type: 'PAGE', title: 'Project Workspace', evidenceDepth: 4 },
    { id: 'art_005', type: 'API', title: 'Document Ingest Endpoint', evidenceDepth: 2 },
    { id: 'art_006', type: 'TEST', title: 'Ingest Classification Test', evidenceDepth: 1 },
    { id: 'art_007', type: 'FINDING', title: 'Requirement gap in auth flow', evidenceDepth: 1 },
  ],
  edges: [
    { from: 'art_001', to: 'art_002', kind: 'contains' },
    { from: 'art_001', to: 'art_003', kind: 'contains' },
    { from: 'art_001', to: 'art_004', kind: 'contains' },
    { from: 'art_004', to: 'art_002', kind: 'depends_on' },
    { from: 'art_004', to: 'art_003', kind: 'depends_on' },
    { from: 'art_005', to: 'art_001', kind: 'implements' },
    { from: 'art_006', to: 'art_005', kind: 'verifies' },
    { from: 'art_007', to: 'art_004', kind: 'found_in' },
  ],
}

/* Traceability (§26) — forward (what this artifact depends on) and
   reverse (what depends on this artifact) links, each anchored to evidence. */

export const mockTraceability = [
  { artifactId: 'art_004', title: 'Project Workspace',
    forward: [
      { target: 'art_002', targetTitle: 'Evidence Trace View', kind: 'depends_on', evidenceId: 'ev_002' },
      { target: 'art_003', targetTitle: 'Blueprint Approval Flow', kind: 'depends_on', evidenceId: 'ev_003' },
    ],
    reverse: [
      { source: 'art_001', sourceTitle: 'Lumina Dashboard', kind: 'contained_by', evidenceId: 'ev_001' },
      { source: 'art_007', sourceTitle: 'Requirement gap in auth flow', kind: 'found_in', evidenceId: 'ev_004' },
    ] },
  { artifactId: 'art_005', title: 'Document Ingest Endpoint',
    forward: [
      { target: 'art_001', targetTitle: 'Lumina Dashboard', kind: 'implements', evidenceId: 'ev_001' },
    ],
    reverse: [
      { source: 'art_006', sourceTitle: 'Ingest Classification Test', kind: 'verified_by', evidenceId: 'ev_003' },
    ] },
  { artifactId: 'art_002', title: 'Evidence Trace View',
    forward: [
      { target: 'art_001', targetTitle: 'Lumina Dashboard', kind: 'part_of', evidenceId: 'ev_001' },
    ],
    reverse: [
      { source: 'art_004', sourceTitle: 'Project Workspace', kind: 'depended_on_by', evidenceId: 'ev_002' },
    ] },
]
