// ============================================================
// Mock data layer (part 1) — types + stage logic. Frontend only.
// Replace fetchMock() calls with real API calls at integration.
// Shapes mirror the spec's domain model (§4) and mapping (§47).
// ============================================================

export type ProjectMode = 'design-only' | 'design-plus-code' | 'full-product'
export type StageStatus = 'PENDING' | 'RECORDED' | 'OUT_OF_SCOPE'
export type StageId = 'discovery' | 'design' | 'design-verification' | 'blueprint' | 'architecture' | 'implementation' | 'testing' | 'verification' | 'deployment' | 'operations' | 'maintenance' | 'continuous-improvement'

export interface Stage {
  id: StageId
  label: string
  num: string
  status: StageStatus
  inScope: boolean
  at?: string | null
}

export interface Project {
  id: string
  name: string
  mode: ProjectMode
  status: 'active' | 'paused' | 'completed'
  owner: string
  description: string
  lastActivity: string
  stages: Stage[]
  approval?: { status: string; approvedAt: string; approvedBy: string } | null
  stagesRunCount?: number
  visionDocId?: string
  attachedDocs?: { id: string; title: string }[]
}

export interface Document {
  id: string
  title: string
  projectId?: string
  type: 'vision' | 'spec' | 'note' | 'ingest'
  size: number
  createdAt: string
  classification: 'inline' | 'document'
}

export interface ActivityItem {
  id: string
  type: 'stage_run' | 'approval' | 'document' | 'auth' | 'project'
  title: string
  timestamp: string
  projectId?: string
}

export interface Provider {
  id: string
  name: string
  description: string
  authMethod: 'api_key' | 'oauth' | 'none' | 'platform'
  website: string
  models: Model[]
}

export interface Model {
  id: string
  providerId: string
  name: string
  accessCategory: string
  contextLength: number
  capabilities: string[]
  status: 'connected' | 'auth_required' | 'rate_limited' | 'model_unavailable' | 'provider_unavailable' | 'unsupported'
}

export interface Credential {
  id: string
  providerId: string
  label: string
  addedAt: string
  verified: boolean
  verifyTimestamp?: string
}

export interface Artifact {
  id: string
  type: string
  title: string
  status: string
  version: number
  projectId: string
  phase: string
}

export interface Evidence {
  id: string
  artifactId: string
  type: string
  summary: string
  recordedAt: string
}

export interface VerificationDimension {
  id: string
  label: string
  state: 'passed' | 'failed' | 'inconclusive' | 'not-run'
  finding?: string
}

export interface TestItem {
  id: string
  name: string
  scope: string
  state: 'passed' | 'failed' | 'queued' | 'running'
  lastRun: string
}

export interface Session {
  id: string
  device: string
  location: string
  lastActive: string
  current: boolean
}

export interface SecurityEvent {
  id: string
  type: string
  detail: string
  timestamp: string
}

export const ALL_STAGES: { id: StageId; label: string; num: string }[] = [
  { id: 'discovery', label: 'Discovery', num: '01' },
  { id: 'design', label: 'Design', num: '02' },
  { id: 'design-verification', label: 'Design Verification', num: '03' },
  { id: 'blueprint', label: 'Blueprint', num: '04' },
  { id: 'architecture', label: 'Architecture', num: '05' },
  { id: 'implementation', label: 'Implementation', num: '06' },
  { id: 'testing', label: 'Testing', num: '07' },
  { id: 'verification', label: 'Verification', num: '08' },
  { id: 'deployment', label: 'Deployment', num: '09' },
  { id: 'operations', label: 'Operations', num: '10' },
  { id: 'maintenance', label: 'Maintenance', num: '11' },
  { id: 'continuous-improvement', label: 'Continuous Improvement', num: '12' },
]

export function stagesForMode(mode: ProjectMode, progress: number): Stage[] {
  const scopeMap: Record<ProjectMode, StageId[]> = {
    'design-only': ['discovery', 'design', 'design-verification'],
    'design-plus-code': ['discovery', 'design', 'design-verification', 'blueprint', 'architecture', 'implementation', 'testing', 'verification'],
    'full-product': ['discovery', 'design', 'design-verification', 'blueprint', 'architecture', 'implementation', 'testing', 'verification', 'deployment', 'operations', 'maintenance', 'continuous-improvement'],
  }
  const inScope = scopeMap[mode]
  return ALL_STAGES.map(s => {
    const idx = inScope.indexOf(s.id)
    let status: StageStatus = 'OUT_OF_SCOPE'
    if (idx >= 0) {
      if (idx <= progress) status = 'RECORDED'
      else status = 'PENDING'
    }
    return { ...s, status, inScope: idx >= 0 }
  })
}

// Simulated async API (swap for real fetch later)
export function fetchMock<T>(data: T, delay = 350): Promise<T> {
  return new Promise(resolve => setTimeout(() => resolve(data), delay))
}

export function classifyIngest(text: string): 'inline' | 'document' {
  return text.length > 8000 ? 'document' : 'inline'
}
