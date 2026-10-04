// API client for NEXORA frontend to communicate with the real backend

const API_BASE = ''

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    credentials: 'include', // Include cookies for session auth
  })

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(error.error || `HTTP ${res.status}`)
  }

  if (res.status === 204) return undefined as T
  return res.json()
}

// Â§ 3.3 TRANSPARENCY â€” the transparency interface is a PROJECTION of persisted
// backend execution state. This client only ever reads what the Execution
// Supervisor, the Job State Manager, the durable event bus and the real
// execution environment actually recorded; it never manufactures a Worker,
// terminal command, file change, test or progress state of its own.

export interface ApiSupervisorSnapshot {
  bootId: string
  lastTickAt: string | null
  tickSeq: number
  networkUp: boolean | null
  lastProbe: { up: boolean; detail: string; at: string } | null
  progressWindowMs: number
  active: Array<{
    jobId: string
    projectId: string
    ownerId: string
    status: string
    stageKey: string
    idleMs: number
    distinctEvidence: number
  }>
}

export interface ApiJobRecord {
  id: string
  projectId: string
  envId: string | null
  stageKey: string
  label: string
  status: string
  attempts: number
  maxAttempts: number
  blockReason: string | null
  waitKind: string | null
  waitReason: string | null
  ai: { providerId: string; modelId: string; configVersion: number; boundAt: string } | null
  startedAt: string | null
  finishedAt: string | null
  error: string | null
  evidenceId: string | null
  createdAt: string
  updatedAt: string
}

export interface ApiEnvRecord {
  id: string
  projectId: string
  label: string
  status: string
  adapterKind: string
  workspaceRoot: string | null
  lastHealth: { ok: boolean; checkedAt: string; detail: string; gitAvailable?: boolean; gitBranch?: string } | null
  createdAt: string
  updatedAt: string
}

export interface ApiExecutionEvent {
  seq: number
  id: string
  ts: string
  type: string
  projectId?: string
  jobId?: string
  payload?: Record<string, unknown>
}

export interface ApiExecutionNode {
  id: string
  stageKey: string
  label: string
  status: string
  ai: { providerId: string; modelId: string } | null
}

export interface ApiExecutionGraph {
  projectId: string
  nodes: ApiExecutionNode[]
  edges: Array<{ from: string; to: string }>
  statusCounts: Record<string, number>
  completedCount: number
  totalCount: number
  blockages: Array<{ id: string; reason: string }>
  unlocked: string[]
}

export const executionApi = {
  supervisor: () => request<ApiSupervisorSnapshot>('/api/working/supervisor'),

  jobs: (projectId?: string) =>
    request<{ jobs: ApiJobRecord[] }>(
      projectId ? `/api/working/jobs?projectId=${encodeURIComponent(projectId)}` : '/api/working/jobs',
    ),

  job: (id: string) => request<ApiJobRecord>(`/api/working/jobs/${encodeURIComponent(id)}`),

  jobAction: (id: string, action: 'pause' | 'resume' | 'cancel' | 'retry') =>
    request<ApiJobRecord>(`/api/working/jobs/${encodeURIComponent(id)}/${action}`, { method: 'POST' }),

  environments: (projectId?: string) =>
    request<{ environments: ApiEnvRecord[] }>(
      projectId
        ? `/api/working/environments?projectId=${encodeURIComponent(projectId)}`
        : '/api/working/environments',
    ),

  envAction: (id: string, action: 'pause' | 'resume' | 'destroy' | 'verify') =>
    request<ApiEnvRecord>(`/api/working/environments/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ action }),
    }),

  createEnvironment: (projectId: string, label: string) =>
    request<ApiEnvRecord>('/api/working/environments', {
      method: 'POST',
      body: JSON.stringify({ projectId, label, gitEnabled: true }),
    }),

  files: (envId: string, path = '') =>
    request<{ path: string; entries: Array<{ name: string; relPath: string; kind: string; size: number; mtime: string }> }>(
      `/api/working/files?envId=${encodeURIComponent(envId)}&path=${encodeURIComponent(path)}`,
    ),

  readFile: (envId: string, path: string) =>
    request<{ content: string; truncated: boolean }>(
      `/api/working/file?envId=${encodeURIComponent(envId)}&path=${encodeURIComponent(path)}`,
    ),

  writeFile: (envId: string, path: string, content: string) =>
    request<{ ok: boolean; path: string }>(
      `/api/working/file?envId=${encodeURIComponent(envId)}&path=${encodeURIComponent(path)}`,
      { method: 'PUT', body: JSON.stringify({ content }) },
    ),

  /** A REAL command executed in the real environment; output is credential-redacted server-side. */
  terminal: (envId: string, command: string) =>
    request<{ exitCode: number; stdout: string; stderr: string; durationMs: number; timedOut: boolean; aborted: boolean }>(
      '/api/working/terminal',
      { method: 'POST', body: JSON.stringify({ envId, command }) },
    ),

  gitStatus: (envId: string) =>
    request<{ branch: string; entries: Array<{ path: string; status: string }> }>(
      `/api/working/git/status?envId=${encodeURIComponent(envId)}`,
    ),

  graph: (projectId: string) =>
    request<ApiExecutionGraph>(`/api/working/project/${encodeURIComponent(projectId)}/graph`),

  events: (projectId: string, after = 0) =>
    request<{ events: ApiExecutionEvent[] }>(
      `/api/working/project/${encodeURIComponent(projectId)}/events?after=${after}`,
    ),

  /** The real-time delivery leg of the 3.3 transparency path (server-sent events). */
  streamUrl: (projectId: string, after = 0) =>
    `/api/working/project/${encodeURIComponent(projectId)}/stream?after=${after}`,
}

// OWNER-ONLY INFRASTRUCTURE CONFIGURATION.
// The backend gates these routes on the platform-owner role; the UI simply
// never renders them for ordinary accounts. The Daytona API key is write-only:
// it is POSTed once and never read back into any client.

export interface ApiDaytonaState {
  status: 'unconfigured' | 'verifying' | 'connected' | 'failed'
  detail: string
  verifiedAt: string | null
  accountLabel: string | null
  capabilities: string[]
  cliVersion: string | null
  credentialId: string | null
}

export interface ApiOwnerDaytona {
  daytona: ApiDaytonaState
  activeBackend: 'local-workspace' | 'daytona'
  daytonaConfigured: boolean
  signupUrl?: string
  docsUrl?: string
}

export const ownerApi = {
  daytona: () => request<ApiOwnerDaytona>('/api/owner/daytona'),

  /** Sends the key once. The backend performs the REAL Daytona verification. */
  saveDaytona: (apiKey: string) =>
    request<ApiOwnerDaytona>('/api/owner/daytona', {
      method: 'PUT',
      body: JSON.stringify({ apiKey }),
    }),

  clearDaytona: () => request<ApiOwnerDaytona>('/api/owner/daytona', { method: 'DELETE' }),
}

// Authentication — the ONLY credential surface.
//
// Sign up with five fields: Full Name, Username, Gmail, Security Question,
// Security Answer. Sign in with three: Gmail, Security Question, Security
// Answer. There is no password, OTP, authenticator, recovery code or email
// verification anywhere in this client.

export interface AccountView {
  id: string
  fullName: string
  username: string
  gmail: string
  securityQuestion: string
  role: 'member' | 'administrator'
  createdAt: string
}

export interface SignupInput {
  fullName: string
  username: string
  gmail: string
  securityQuestion: string
  securityAnswer: string
}

export interface LoginInput {
  gmail: string
  securityQuestion: string
  securityAnswer: string
}

export const authApi = {
  /** The security questions an account may be created with. Public by design. */
  securityQuestions: () => request<{ questions: string[] }>('/api/auth/security-questions'),

  /**
   * Creates an account. Issues NO session — the caller must sign in.
   * Every account, privileged or not, is created here.
   */
  signup: (input: SignupInput) =>
    request<{ account: AccountView }>('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  /** The single sign-in route for every account. */
  login: (input: LoginInput) =>
    request<{ account: AccountView; canManagePlatform: boolean }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  logout: () => request<void>('/api/auth/logout', { method: 'POST' }),

  /** Resolved server-side from the session cookie. Never from a client field. */
  session: () =>
    request<{ account: AccountView | null; canManagePlatform: boolean }>('/api/auth/session'),

  // Non-authenticating account settings.
  updateProfile: (fullName: string) =>
    request<{ account: AccountView }>('/api/account/profile', {
      method: 'POST',
      body: JSON.stringify({ fullName }),
    }),

  getPreferences: () =>
    request<{ preferences: Record<string, unknown> }>('/api/account/preferences'),

  updatePreferences: (preferences: Record<string, unknown>) =>
    request<{ preferences: Record<string, unknown> }>('/api/account/preferences', {
      method: 'POST',
      body: JSON.stringify(preferences),
    }),
}

// Projects
export interface ApiProjectAiConfig {
  providerId: string
  modelId: string
  credentialId?: string
}

export interface ApiProjectSummary {
  id: string
  title: string
  mode: string
  status: string
  lifecycleComplete: string | null
}

export const projectsApi = {
  list: () =>
    request<{ count: number; projects: ApiProjectSummary[] }>('/api/projects'),

  get: (id: string) =>
    request<{
      id: string
      title: string
      mode: string
      status: string
      lifecycleComplete: string | null
      description: string
      owner: { userId: string; label: string } | null
      scope: string[]
      config: Record<string, unknown>
      createdAt: string
      updatedAt: string | null
      stages: Array<{ stageId: string; label: string; inScope: boolean; status: string; at: string | null; providerId?: string | null; modelId?: string | null }>
      aiOutputs: Record<string, { providerId: string; modelId: string; content: string; latencyMs: number; at: string; evidenceId: string }>
      approval: { status: string; approvedAt: string; approvedBy: string } | null
      stagesRunCount: number
      aiConfig: ApiProjectAiConfig | null
    }>(`/api/projects/${id}`),

  create: (
    name: string,
    vision: string,
    mode: string,
    visionDocumentId?: string,
    aiConfig?: ApiProjectAiConfig | null,
  ) =>
    request<{
      project: ApiProjectSummary
      aiConfig?: ApiProjectAiConfig | null
      summary: { discoveryArtifacts: number; message: string }
    }>('/api/projects', {
      method: 'POST',
      body: JSON.stringify({
        name,
        vision,
        mode,
        visionDocumentId,
        ...(aiConfig
          ? { providerId: aiConfig.providerId, modelId: aiConfig.modelId, credentialId: aiConfig.credentialId }
          : {}),
      }),
    }),

  updateAiConfig: (id: string, cfg: ApiProjectAiConfig | null) =>
    request<{ project: ApiProjectSummary; aiConfig: ApiProjectAiConfig | null }>(`/api/projects/${id}/ai-config`, {
      method: 'PUT',
      body: JSON.stringify(cfg ?? {}),
    }),

  update: (id: string, options?: { title?: string; mode?: string; description?: string }) =>
    request<{ project: ApiProjectSummary }>(`/api/projects/${id}`, {
      method: 'PUT',
      body: JSON.stringify(options ?? {}),
    }),

  delete: (id: string) =>
    request<void>(`/api/projects/${id}`, { method: 'DELETE' }),

  runStage: (id: string, stageId: string, instruction?: string) =>
    request<{
      projectId: string; stageId: string; label: string; status: string; at: string; summary: string
      providerId?: string; modelId?: string; latencyMs?: number; evidenceId?: string; content?: string
    }>(`/api/projects/${id}/run/${stageId}`, {
      method: 'POST',
      ...(instruction && instruction.trim() ? { body: JSON.stringify({ instruction }) } : {}),
    }),

  approveBlueprint: (id: string) =>
    request<{ projectId: string; status: string; approvedAt: string; approvedBy: string; summary: string }>(`/api/projects/${id}/approve`, {
      method: 'POST',
    }),
}

// Documents
export const documentsApi = {
  list: () =>
    request<{ documents: Array<{ id: string; ownerId: string; charLength: number; byteLength: number; preview: string; contentHash: string }>; count: number }>('/api/documents'),

  get: (id: string, full = false) =>
    request<{ id: string; ownerId: string; charLength: number; byteLength: number; preview: string; contentHash: string; content?: string }>(`/api/documents/${id}${full ? '?full=true' : ''}`),

  upload: (file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    return fetch(`${API_BASE}/api/documents/upload`, {
      method: 'POST',
      body: formData,
      credentials: 'include',
    }).then(async (res) => {
      if (!res.ok) {
        const error = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error(error.error || `HTTP ${res.status}`)
      }
      return res.json()
    })
  },

  delete: (id: string) =>
    request<void>(`/api/documents/${id}`, { method: 'DELETE' }),

  // Chat ingest - for vision/intent processing
  ingest: (text: string) =>
    request<{ kind: 'message' | 'document'; message?: string; charLength?: number; documentRef?: { id: string; ownerId: string; charLength: number; byteLength: number; preview: string; contentHash: string; createdAt: string } }>('/api/chat/ingest', {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),
}

// Models / Providers
export interface ApiModelCapabilities { streaming: boolean; toolCalling: boolean; vision: boolean; reasoning: boolean; structuredOutput: boolean }
export interface ApiModelRow {
  providerId: string; modelId: string; name: string; providerName: string
  accessCategory: string; contextLength: number; maxOutputTokens: number
  capabilities: ApiModelCapabilities
  inputCostPer1M: number | null; outputCostPer1M: number | null
  available: boolean; verified: boolean; sources: string[]
}
export interface ApiSelectionState {
  userId: string; providerId: string; modelId: string; category: string
  connectionVerified: boolean; status: string; detail?: string | null
}
export const modelsApi = {
  list: (params?: { q?: string; accessCategory?: string[]; providerId?: string; availableOnly?: boolean }) => {
    const searchParams = new URLSearchParams()
    if (params?.q) searchParams.set('q', params.q)
    if (params?.providerId) searchParams.set('providerId', params.providerId)
    if (params?.accessCategory) params.accessCategory.forEach(c => searchParams.append('accessCategory', c))
    if (params?.availableOnly) searchParams.set('availableOnly', 'true')
    return request<{ total: number; models: ApiModelRow[]; sources: string[]; localHubUnavailable?: boolean }>(`/api/models?${searchParams.toString()}`)
  },

  stats: () =>
    request<{ totalModels: number; byCategory: Record<string, number>; byProvider: Record<string, number>; verifiedCount: number; sourceCount: number }>('/api/models/stats'),

  get: (providerId: string, modelId: string) =>
    request<ApiModelRow>(`/api/models/${providerId}/${modelId}`),

  selection: () =>
    request<{ selection: ApiSelectionState | null }>('/api/models/selection'),

  select: (providerId: string, modelId: string) =>
    request<{ selection: ApiSelectionState }>('/api/models/select', {
      method: 'POST',
      body: JSON.stringify({ providerId, modelId }),
    }),
}

// Providers (hub description + real connection verification)
export interface ApiProviderDescriptor {
  providerId: string
  name: string
  description: string
  authMethod: 'api_key' | 'oauth' | 'none' | 'platform'
  credentialRequired: boolean
  accessCategories: string[]
  websiteUrl: string
  docsUrl: string
  configured: boolean
  connectionVerified: boolean
  lastConnectionResult: ApiConnectionTestResult | null
  modelCount?: number
  /** True when this build has a real execution adapter for the provider. */
  wired?: boolean
}
export const providersApi = {
  list: () =>
    request<{ providers: ApiProviderDescriptor[] }>('/api/providers'),

  verify: (providerId: string) =>
    request<ApiConnectionTestResult>(`/api/providers/${providerId}/verify`, {
      method: 'POST',
    }),
}

// Credentials
export interface ApiCredentialRow {
  id: string; providerId: string; userId: string; createdAt: string
  verified: boolean; lastError: string | null
}
export interface ApiConnectionTestResult {
  success: boolean; timestamp: string; latencyMs?: number; errorMessage?: string; modelsAvailable?: number
}
export const credentialsApi = {
  list: () =>
    request<{ credentials: ApiCredentialRow[] }>('/api/credentials'),

  add: (providerId: string, secret: string) =>
    request<ApiCredentialRow>('/api/credentials', {
      method: 'POST',
      body: JSON.stringify({ providerId, secret }),
    }),

  delete: (id: string) =>
    request<void>(`/api/credentials/${id}`, { method: 'DELETE' }),

  verify: (id: string) =>
    request<ApiConnectionTestResult>(`/api/credentials/${id}/verify`, {
      method: 'POST',
    }),
}

// Dashboard / Summary
export const dashboardApi = {
  summary: () =>
    request<{
      productName: string
      projectId: string
      project: { id: string; title: string; mode: string; lifecycleComplete: string | null }
      envName: string
      dataDir: string
      provider: string
      providerCalls: number
      storeKind: string
      evidenceCount: number
      graph: Record<string, number>
      discoveryArtifacts: number
      designCoverage: { coveredCount: number; totalDimensions: number; missing: string[]; assessmentHash: string }
      businessModel: { roleCount: number; permissionCount: number; entityCount: number; workflowCount: number; adminRoles: string[] }
      threatModel: { threatCount: number; strideCategories: string[]; requirementCount: number; p0Count: number }
      uxVerification: { tokenScore: number; accessibilityScore: number; responsiveScore: number; overallScore: number; findingsCount: number }
      designCodeTrace: { total: number; traced: number; unimplemented: number; orphans: number; forwardComplete: boolean; reverseComplete: boolean }
      projectBinding: { documentCount: number; documentIds: string[]; ownerCount: number }
      portability: { artifactCount: number; edgeCount: number; evidenceCount: number; integrityVerified: boolean }
      account: { accountCount: number; ownerAccountId: string; ownerCanAccess: boolean; strangerCanAccess: boolean }
      designQuality: { overallScore: number; identitySpecificity: number; componentConsistency: number; accessibility: number; findingsCount: number }
      designConsistency: { overallConsistency: number; tokenVariance: number; componentVariance: number; spacingVariance: number; typographyVariance: number; exceptionsCount: number }
      visual: { identityTone: string; seedHue: number; seedSaturation: number; componentCount: number; motionDurationStandard: number; reducedMotion: boolean }
      blueprintId: string
      manifestId: string | null
      certified: boolean
      certifiedStamped: number
      certificationEvidenceId: string | null
      councilVerdict: string
      masterPassed: boolean
      traceComplete: boolean
      opsUnitsReleased: number
      continuousVerdict: string
      safeChangeStatus: string
      peoClassification: string
      peoAuthorized: boolean
    }>('/api/summary'),

  activity: () =>
    request<{ activity: Array<{ type: string; id: string; title: string; timestamp: string }> }>('/api/activity'),

  roadmap: () =>
    request<{ roadmap: Array<{ level: string; title: string; status: string }> }>('/api/roadmap'),

  caps: () =>
    request<{ availableNotExercised: Array<{ id: string; label: string; module: string; note: string }> }>('/api/caps'),
}

// Stage endpoints (Blueprint-First Workspace)
export const stagesApi = {
  discovery: () =>
    request<{ status: string; error: string | null; baseline: unknown; artifactIds: string[]; findingIds: string[]; diff: unknown; uncertainties: unknown }>('/api/discovery'),

  design: () =>
    request<{ status: string; blueprintId: string | null; artifactIds: string[]; approval: unknown }>('/api/design'),

  council: () =>
    request<{ subject: string | null; verdict: string; seats: unknown }>('/api/council'),

  verification: () =>
    request<{ masterPassed: boolean | null; subjectsAudited: number; blockingFails: number; unresolvedInconclusive: number; notes: string | null; closureArtifactCount: number; rollup: unknown; reports: number }>('/api/verification'),

  testing: () =>
    request<{ status: string; executed: number; testIds: string[]; reportId: string | null; evidenceId: string | null; advancedToTestVerified: boolean | null; docHalts: unknown; boss: unknown; auditor: unknown }>('/api/testing'),

  deployment: () =>
    request<{ status: string; executed: number; deployIds: string[]; manifestId: string | null; evidenceId: string | null; advancedToDeployedVerified: boolean | null; docHalts: unknown; boss: unknown; auditor: unknown }>('/api/deployment'),

  telemetry: () =>
    request<{ observation: unknown; sourceKind: string }>('/api/telemetry'),

  continuous: () =>
    request<{ finalVerdict: string; rationale: string | null; workerReport: unknown; bossDecision: unknown; auditorDecision: unknown; materialization: unknown }>('/api/continuous'),

  recursion: () =>
    request<{ classification: string; allRemediated: boolean | null; changeCount: number; baseIds: string[] }>('/api/recursion'),

  safeChange: () =>
    request<{ status: string; reason: string | null; trail: unknown; materialization: unknown; finalDocState: unknown }>('/api/safe-change'),

  peo: () =>
    request<{ source: unknown; authorized: boolean | null; escalated: boolean | null; rationale: string | null; watch: unknown; impact: unknown; change: unknown; candidate: unknown }>('/api/peo'),

  certification: () =>
    request<{ certified: boolean | null; reasons: unknown; stampedArtifactIds: string[]; evidenceId: string | null; confidence: unknown; certifiable: boolean | null; status: string; trace: unknown }>('/api/certification'),

  traceability: () =>
    request<unknown>('/api/traceability'),

  // Â§0.6 Recursive Page Expansion â€” 14-layer determination, Pass 10.
  expansion: () =>
    request<{
      status: string
      pages: Array<{
        pageId: string
        pageKey: string
        title: string
        allLayersDetermined: boolean
        omissions: string[]
        layers: Array<{ layer: number; name: string; status: string; note: string; artifactIds: string[] }>
      }>
      tally: { covered: number; added: number; 'not-relevant': number; blocked: number } | null
      artifactIds: string[]
      fullDepartment: {
        contentAdded: number
        edgeStatesAdded: number
        risks: number
        audited: boolean
        artifactIds: string[]
      } | null
    }>('/api/expansion'),

  // Â§1.4 Interactive Digital Twin â€” element -> DESIGN -> Discovery -> evidence.
  twin: () =>
    request<{
      projectId: string | null
      blueprintId: string | null
      twinArtifactId: string | null
      pages: Array<{
        pageId: string
        pageKey: string
        title: string
        designId: string | null
        designBound: boolean
        elements: Array<{
          id: string
          kind: 'section' | 'action' | 'state' | 'validation' | 'content' | 'requirement'
          label: string
          surface: string
          discoveryArtifactId: string
          designArtifactId: string | null
          designBound: boolean
          evidenceIds: string[]
          trace: Array<{ artifactId: string; kind: 'discovery' | 'design' | 'evidence'; label: string }>
        }>
        edges: Array<{ from: string; to: string; relation: string }>
        gaps: Array<{ severity: 'warning' | 'error'; message: string; pageId: string; artifactId?: string }>
      }>
      elementCount: number
      boundElementCount: number
      gapCount: number
      evidenceCount: number
      built: boolean
      note: string | null
    }>('/api/twin'),
}

// Artifacts
export const artifactsApi = {
  list: () =>
    request<{ count: number; artifacts: Array<{ id: string; type: string; title: string; status: string; docState: string | null; version: number; projectId: string; confidence: number | null; evidenceIds: string[] }> }>('/api/artifacts'),

  get: (id: string) =>
    request<unknown>(`/api/artifacts/${id}`),
}

// Dependency map
export const dependencyMapApi = {
  get: () =>
    request<{ nodeCount: number; edgeCount: number; edges: Array<{ from: string; relation: string; to: string }> }>('/api/dependency-map'),
}

// Lineage
export const lineageApi = {
  get: () =>
    request<{ firstPageId: string; links: unknown[]; completeThrough: string; gaps: unknown[] }>('/api/lineage'),
}

// Evidence
export const evidenceApi = {
  list: () =>
    request<{ count: number; entries: unknown[] }>('/api/evidence'),
}

// Platform startup gate / execution foundation
export interface ApiCapabilityDecision {
  capability: string
  status: string
  mechanism: string | null
  version: string | null
  rationale: string
  discoveredAt: string
}
export interface ApiFoundationReport {
  generatedAt: string
  policy: 'production' | 'development-local'
  productionReady: boolean
  /** True only when every mandatory component AND every control-plane probe passed. */
  startupGateOpen: boolean
  opencodeReady: boolean
  clineReady: boolean
  clineDetail?: string
  daytonaReady: boolean
  daytonaDetail?: string
  localReady: boolean
  environmentBackend: 'local-workspace' | 'daytona'
  summary: string
  capabilities: ApiCapabilityDecision[]
  controlPlane: Array<{ capability: string; ready: boolean; detail: string; checkedAt: string }>
}
export const systemApi = {
  foundation: () =>
    request<ApiFoundationReport>('/api/system/foundation'),
}

// Export all APIs
export const api = {
  auth: authApi,
  projects: projectsApi,
  documents: documentsApi,
  models: modelsApi,
  providers: providersApi,
  credentials: credentialsApi,
  dashboard: dashboardApi,
  stages: stagesApi,
  artifacts: artifactsApi,
  dependencyMap: dependencyMapApi,
  lineage: lineageApi,
  evidence: evidenceApi,
  system: systemApi,
}

export default api


