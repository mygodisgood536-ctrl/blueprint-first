import { useState, useCallback, createContext, useContext, ReactNode, useEffect } from 'react'
import { navigate } from './router'
import { Project, ProjectMode, stagesForMode, StageId, StageStatus } from './mock/data'
import { api } from './api'

interface Toast { id: number; message: string; type: 'success' | 'error' | 'info' }
interface AuthState {
  authenticated: boolean
  id: string
  username: string
  displayName: string
  totpEnabled: boolean
  totpPending: boolean
  authenticatorRequired: boolean
  /** True while the account has not yet created its recovery question/answers. */
  recoveryPending: boolean
  /** Where the account stands in the mandatory first-time setup. */
  setupStage: 'recovery' | 'authenticator' | 'complete'
  setupComplete: boolean
  role: string
  createdAt: string
}

/** Builds the auth state from an account view returned by the backend. */
function authFromAccount(
  account: {
    id: string
    username: string
    displayName: string
    role: string
    createdAt: string
    authenticatorRequired: boolean
    recoveryRequired?: boolean
    setupStage?: 'recovery' | 'authenticator' | 'complete'
    setupComplete?: boolean
  },
  totpEnabled: boolean,
): AuthState {
  const stage = account.setupStage ?? 'complete'
  return {
    authenticated: true,
    id: account.id,
    username: account.username,
    displayName: account.displayName,
    totpEnabled,
    totpPending: account.authenticatorRequired === true && !totpEnabled,
    authenticatorRequired: account.authenticatorRequired === true,
    recoveryPending: account.recoveryRequired === true,
    setupStage: stage,
    setupComplete: account.setupComplete === true,
    role: account.role,
    createdAt: account.createdAt,
  }
}

interface LoginChallenge {
  challengeId: string
  expiresAt: string
  username: string
}

interface StoreContextType {
  auth: AuthState
  login: (username: string, password: string) => Promise<{ ok: boolean; totpEnabled: boolean; totpPending: boolean; requiresAuthenticator?: boolean }>
  loginVerify: (code: string) => Promise<{ ok: boolean }>
  /** First-time administration setup, from the private administration entry. */
  ownerSignup: (username: string, displayName: string, password: string) => Promise<{ ok: boolean; reason: string }>
  /** First-time account creation, from the public product entry. */
  userSignup: (username: string, displayName: string, password: string) => Promise<{ ok: boolean; reason: string }>
  logout: () => Promise<void>
  enableTotp: (code: string) => Promise<string[]>
  disableTotp: (code: string) => Promise<void>
  updateProfile: (displayName: string) => Promise<void>
  changePassword: (newPassword: string, recoveryAnswers: Array<{ questionId: string; answer: string }>) => Promise<void>
  /** First-time setup: stores the account's recovery question/answers. */
  setupRecoveryQuestions: (answers: Array<{ questionId: string; answer: string }>) => Promise<{ ok: boolean; reason?: string }>
  toasts: Toast[]
  pushToast: (message: string, type?: Toast['type']) => void
  sidebarCollapsed: boolean
  toggleSidebar: () => void
  createProject: (input: { name: string; mode: ProjectMode; description?: string; vision?: string; attachedDocs?: { id: string; title: string }[] }) => Promise<Project>
  updateProject: (id: string, patch: Partial<Project>) => Promise<void>
  deleteProject: (id: string) => Promise<boolean>
  getProject: (id: string) => Promise<Project | undefined>
  listProjects: () => Promise<Project[]>
  running: { projectId: string; stage: string } | null
  startStageRun: (projectId: string, stage: string) => void
  endStageRun: () => void
  runProjectStage: (projectId: string, stageId: string, instruction?: string) => Promise<{ projectId: string; stageId: string; label: string; status: string; at: string; summary: string }>
  approveProject: (projectId: string) => Promise<{ projectId: string; status: string; approvedAt: string; approvedBy: string; summary: string }>
  totpCode: string
  setTotpCode: (c: string) => void
  recoveryCode: string
  setRecoveryCode: (c: string) => void
  loginChallenge: LoginChallenge | null
  clearLoginChallenge: () => void
  // Authenticator setup. During first-time setup no authorization is needed;
  // changing an already-active authenticator requires the recovery answers.
  totpSetup: { secret: string; otpauth: string } | null
  fetchTotpSetup: (recoveryAnswers?: Array<{ questionId: string; answer: string }>) => Promise<void>
  // Sessions
  sessions: Array<{ createdAt: string; expiresAt: string; current: boolean }>
  fetchSessions: () => Promise<void>
  revokeOtherSessions: () => Promise<void>
  // Security events
  securityEvents: Array<{ accountId: string; kind: string; at: string; detail?: string }>
  fetchSecurityEvents: () => Promise<void>
  // Preferences
  preferences: Record<string, unknown>
  fetchPreferences: () => Promise<void>
  updatePreferences: (preferences: Record<string, unknown>) => Promise<void>
  // Document upload
  uploadDocument: (file: File) => Promise<{ document: { id: string; preview: string; charLength: number; byteLength: number; contentHash: string }; fileName: string | null }>
  // Chat ingest
  ingestText: (text: string) => Promise<{ kind: 'message' | 'document'; message?: string; charLength?: number; documentRef?: { id: string; ownerId: string; charLength: number; byteLength: number; preview: string; contentHash: string; createdAt: string } }>
}

const StoreContext = createContext<StoreContextType | null>(null)

let toastId = 0

export function StoreProvider({ children }: { children: ReactNode }) {
  const readSession = (): AuthState => {
    // Session is managed by backend cookies, so we just track auth state locally
    return { authenticated: false, id: '', username: '', displayName: '', totpEnabled: false, totpPending: false, authenticatorRequired: false, recoveryPending: false, setupStage: 'recovery' as const, setupComplete: false, role: '', createdAt: '' }
  }
  const [auth, setAuth] = useState<AuthState>(readSession)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [totpCode, setTotpCode] = useState('')
  const [recoveryCode, setRecoveryCode] = useState('')
  const [projects, setProjects] = useState<Project[]>([])
  const [running, setRunning] = useState<{ projectId: string; stage: string } | null>(null)
  const [totpSetup, setTotpSetup] = useState<{ secret: string; otpauth: string } | null>(null)
  const [sessions, setSessions] = useState<Array<{ createdAt: string; expiresAt: string; current: boolean }>>([])
  const [securityEvents, setSecurityEvents] = useState<Array<{ accountId: string; kind: string; at: string; detail?: string }>>([])
  const [loginChallenge, setLoginChallenge] = useState<LoginChallenge | null>(null)
  const [preferences, setPreferences] = useState<Record<string, unknown>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const persist = (a: AuthState) => {
    setAuth(a)
  }

  const pushToast = useCallback((message: string, type: Toast['type'] = 'info') => {
    const id = ++toastId
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500)
  }, [])

// Initialize auth state from backend
  useEffect(() => {
    const initAuth = async () => {
      try {
        const res = await api.auth.me()
        if (res.account) {
          let totpEnabled = false
          try {
            const status = await api.auth.totpStatus()
            totpEnabled = status.enabled
          } catch { /* authenticator status unavailable */ }
          setAuth(authFromAccount(res.account, totpEnabled))
        }
      } catch {
        // Not authenticated
        setAuth(readSession())
      }
    }
    initAuth()
  }, [])

  const login = useCallback(async (usernameOrEmail: string, password: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.auth.login(usernameOrEmail, password)
      if (res.requiresAuthenticator === true && typeof res.challengeId === 'string') {
        setLoginChallenge({
          challengeId: res.challengeId,
          expiresAt: typeof res.expiresAt === 'string' ? res.expiresAt : '',
          username: typeof res.username === 'string' ? res.username : usernameOrEmail,
        })
        pushToast('Enter your authenticator code to finish signing in', 'info')
        return { ok: true, totpEnabled: true, totpPending: true, requiresAuthenticator: true }
      }
      const account = (res as { account?: Parameters<typeof authFromAccount>[0] }).account
      if (!account) throw new Error('Unexpected login response')
      let totpEnabled = false
      try {
        const status = await api.auth.totpStatus()
        totpEnabled = status.enabled
      } catch { /* authenticator status unavailable */ }
      setAuth(authFromAccount(account, totpEnabled))
      pushToast('Welcome back', 'success')
      return { ok: true, totpEnabled, totpPending: false }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Incorrect username or password.'
      setError(message)
      return { ok: false, totpEnabled: false, totpPending: false }
    } finally {
      setLoading(false)
    }
  }, [pushToast])

  const loginVerify = useCallback(async (code: string): Promise<{ ok: boolean }> => {
    setLoading(true)
    setError(null)
    try {
      if (loginChallenge === null) throw new Error('No pending sign-in. Enter your username and password first.')
      const res = await api.auth.loginVerify(loginChallenge.challengeId, code)
      let totpEnabled = false
      try {
        const status = await api.auth.totpStatus()
        totpEnabled = status.enabled
      } catch { /* authenticator status unavailable */ }
      setAuth(authFromAccount(res.account, totpEnabled))
      setLoginChallenge(null)
      pushToast('Authenticated', 'success')
      return { ok: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'That code is not valid.'
      setError(message)
      return { ok: false }
    } finally {
      setLoading(false)
    }
  }, [loginChallenge, pushToast])

  const clearLoginChallenge = useCallback(() => {
    setLoginChallenge(null)
  }, [])

  /**
   * FIRST-TIME SETUP, shared body for both dedicated entry points. The account
   * is never usable straight away: the backend reports the next mandatory
   * stage, which the router walks through (recovery, then authenticator).
   */
  const beginSetup = useCallback(
    async (
      create: () => Promise<{ account: Parameters<typeof authFromAccount>[0]; nextStage: string }>,
      welcome: string,
    ): Promise<{ ok: boolean; reason: string }> => {
      setLoading(true)
      setError(null)
      try {
        const res = await create()
        // A brand-new account always has no authenticator yet.
        setAuth(authFromAccount(res.account, false))
        pushToast(welcome, 'success')
        return { ok: true, reason: res.nextStage }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Account setup failed.'
        setError(message)
        return { ok: false, reason: message }
      } finally {
        setLoading(false)
      }
    },
    [pushToast],
  )

  /** First-time administration setup, from the private administration entry. */
  const ownerSignup = useCallback(
    (username: string, displayName: string, password: string) =>
      beginSetup(() => api.auth.ownerSignup(username, displayName, password), 'Administration account created'),
    [beginSetup],
  )

  /** First-time account creation, from the public product entry. */
  const userSignup = useCallback(
    (username: string, displayName: string, password: string) =>
      beginSetup(() => api.auth.userSignup(username, displayName, password), 'Account created — welcome to NEXORA'),
    [beginSetup],
  )

  /**
   * First-time recovery question/answer setup. Answers go straight to the
   * backend, which hashes them; they are never held in app state or logged.
   */
  const setupRecoveryQuestions = useCallback(
    async (answers: Array<{ questionId: string; answer: string }>): Promise<{ ok: boolean; reason?: string }> => {
      setLoading(true)
      setError(null)
      try {
        const res = await api.auth.recoverySetup(answers)
        setAuth((a) => ({
          ...a,
          recoveryPending: false,
          setupStage: res.nextStage as AuthState['setupStage'],
          setupComplete: res.account.setupComplete === true,
        }))
        pushToast('Recovery questions saved securely', 'success')
        return { ok: true }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Recovery setup failed.'
        setError(message)
        return { ok: false, reason: message }
      } finally {
        setLoading(false)
      }
    },
    [pushToast],
  )

  const logout = useCallback(async () => {
    try {
      await api.auth.logout()
    } catch { /* ignore */ }
    setAuth(readSession())
    setProjects([])
    navigate('#/welcome')
    pushToast('You have been logged out', 'info')
  }, [pushToast])

  const enableTotp = useCallback(async (code: string): Promise<string[]> => {
    try {
      const res = await api.auth.totpEnable(code)
      // A verified 6-digit code completes the last mandatory setup step, so the
      // account is now fully set up and may enter the dashboard.
      setAuth((a) => ({
        ...a,
        totpEnabled: true,
        totpPending: false,
        setupStage: 'complete',
        setupComplete: true,
      }))
      pushToast('Authenticator verified — setup complete', 'success')
      return res.recoveryCodes ?? []
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to enable authenticator'
      setError(message)
      throw err
    }
  }, [pushToast])

  const disableTotp = useCallback(async (code: string) => {
    try {
      await api.auth.totpDisable(code)
      setAuth((a) => ({ ...a, totpEnabled: false, totpPending: !!a.authenticatorRequired }))
      pushToast('Authenticator disabled', 'info')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to disable authenticator'
      setError(message)
      throw err
    }
  }, [pushToast])

  const updateProfile = useCallback(async (displayName: string) => {
    setLoading(true)
    try {
      await api.auth.updateProfile(displayName.trim())
      const next = { ...auth, displayName: displayName.trim() }
      persist(next)
      pushToast('Profile updated', 'success')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update profile'
      setError(message)
      throw err
    } finally {
      setLoading(false)
    }
  }, [auth, pushToast])

  /** Sensitive change: authorized by the account's recovery answers. */
  const changePassword = useCallback(async (newPassword: string, recoveryAnswers: Array<{ questionId: string; answer: string }>) => {
    setLoading(true)
    try {
      await api.auth.changePassword(newPassword, recoveryAnswers)
      pushToast('Password updated', 'success')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to change password'
      setError(message)
      throw err
    } finally {
      setLoading(false)
    }
  }, [pushToast])

  const toggleSidebar = useCallback(() => setSidebarCollapsed(p => !p), [])

  const fetchProjects = useCallback(async () => {
    try {
      const res = await api.projects.list()
      const mappedProjects: Project[] = res.projects.map(p => ({
        id: p.id,
        name: p.title,
        mode: p.mode as ProjectMode,
        status: (p.status as 'active' | 'paused' | 'completed') || 'active',
        owner: p.title,
        description: '',
        lastActivity: new Date().toISOString(),
        stages: stagesForMode(p.mode as ProjectMode, 0),
      }))
      setProjects(mappedProjects)
      return mappedProjects
    } catch {
      setProjects([])
      return []
    }
  }, [])

  const createProject = useCallback(async (input: { name: string; mode: ProjectMode; description?: string; vision?: string; attachedDocs?: { id: string; title: string }[] }) => {
    setLoading(true)
    try {
      const res = await api.projects.create(input.name, input.vision || input.description || '', input.mode, input.attachedDocs?.[0]?.id)
      const project: Project = {
        id: res.project.id,
        name: res.project.title,
        mode: res.project.mode as ProjectMode,
        status: (res.project.status as 'active' | 'paused' | 'completed') || 'active',
        owner: auth.username || 'you',
        description: input.description?.trim() || (input.vision ? input.vision.slice(0, 120) : ''),
        lastActivity: new Date().toISOString(),
        stages: stagesForMode(input.mode, 0),
      }
      if (input.attachedDocs?.length) project.attachedDocs = input.attachedDocs
      setProjects(prev => [...prev, project])
      pushToast('Project created', 'success')
      return project
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create project'
      setError(message)
      throw err
    } finally {
      setLoading(false)
    }
  }, [auth.username, pushToast])

  const updateProject = useCallback(async (id: string, patch: Partial<Project>) => {
    try {
      await api.projects.update(id, {
        title: patch.name,
        mode: patch.mode,
        ...(typeof patch.description === 'string' ? { description: patch.description } : {}),
      })
      setProjects(prev => prev.map(p => p.id === id ? { ...p, ...patch, lastActivity: new Date().toISOString() } : p))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update project'
      setError(message)
      throw err
    }
  }, [])

  const deleteProject = useCallback(async (id: string) => {
    try {
      await api.projects.delete(id)
      setProjects(prev => prev.filter(p => p.id !== id))
      pushToast('Project deleted', 'success')
      return true
    } catch {
      pushToast('Failed to delete project', 'error')
      return false
    }
  }, [pushToast])

  const getProject = useCallback(async (id: string) => {
    // Always fetch the fresh project detail so stage status, approval, and
    // lifecycle reflect the server's ledger; fall back to the local cache
    // only when the network is unavailable.
    try {
      const res = await api.projects.get(id)
      return {
        id: res.id,
        name: res.title,
        mode: res.mode as ProjectMode,
        status: (res.status as 'active' | 'paused' | 'completed') || 'active',
        owner: res.owner?.label || '',
        description: res.description,
        lastActivity: res.updatedAt || res.createdAt,
        approval: res.approval,
        stagesRunCount: res.stagesRunCount,
        aiConfig: res.aiConfig ?? null,
        stages: res.stages.map(s => ({ 
          id: s.stageId as StageId, 
          label: s.label, 
          num: '', 
          status: s.status as StageStatus, 
          at: s.at ?? null,
          inScope: s.inScope 
        })),
      } as Project
    } catch {
      const cached = projects.find(p => p.id === id)
      return cached
    }
  }, [projects])

  const listProjects = useCallback(async () => {
    if (projects.length === 0) {
      await fetchProjects()
    }
    return projects
  }, [projects, fetchProjects])

  const startStageRun = useCallback((projectId: string, stage: string) => setRunning({ projectId, stage }), [])
  const endStageRun = useCallback(() => setRunning(null), [])

  const runProjectStage = useCallback(async (projectId: string, stageId: string, instruction?: string) => {
    try {
      const res = await api.projects.runStage(projectId, stageId, instruction)
      pushToast(res.summary || `${res.label} recorded`, instruction ? 'info' : 'success')
      return res
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Stage run failed'
      pushToast(message, 'error')
      throw err
    }
  }, [pushToast])

  const approveProject = useCallback(async (projectId: string) => {
    try {
      const res = await api.projects.approveBlueprint(projectId)
      pushToast(res.summary || 'Blueprint approved', 'success')
      return res
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Approval failed'
      pushToast(message, 'error')
      throw err
    }
  }, [pushToast])

  // Fetch TOTP setup
  /**
   * Starts authenticator enrollment. During first-time setup no authorization is
   * required (the account has no recovery questions yet). Replacing an active
   * authenticator is a sensitive change and must present the recovery answers.
   */
  const fetchTotpSetup = useCallback(async (recoveryAnswers?: Array<{ questionId: string; answer: string }>) => {
    try {
      const res = await api.auth.totpSetup(recoveryAnswers)
      setTotpSetup(res)
    } catch (err) {
      setTotpSetup(null)
      throw err
    }
  }, [])

  // Sessions
  const fetchSessions = useCallback(async () => {
    try {
      const res = await api.auth.listSessions()
      setSessions(res.sessions)
    } catch {
      setSessions([])
    }
  }, [])

  const revokeOtherSessions = useCallback(async () => {
    try {
      await api.auth.revokeOtherSessions()
      await fetchSessions()
      pushToast('Signed out of all other sessions', 'success')
    } catch {
      pushToast('Failed to revoke sessions', 'error')
    }
  }, [fetchSessions, pushToast])

  // Security events
  const fetchSecurityEvents = useCallback(async () => {
    try {
      const res = await api.auth.listSecurityEvents()
      setSecurityEvents(res.events)
    } catch {
      setSecurityEvents([])
    }
  }, [])

  // Preferences
  const fetchPreferences = useCallback(async () => {
    try {
      const res = await api.auth.getPreferences()
      setPreferences(res.preferences)
    } catch {
      setPreferences({})
    }
  }, [])

  const updatePreferences = useCallback(async (newPrefs: Record<string, unknown>) => {
    try {
      await api.auth.updatePreferences(newPrefs)
      setPreferences(newPrefs)
      pushToast('Preferences updated', 'success')
    } catch {
      pushToast('Failed to update preferences', 'error')
    }
  }, [pushToast])

  // Document upload
  const uploadDocument = useCallback(async (file: File) => {
    setLoading(true)
    try {
      const res = await api.documents.upload(file)
      pushToast('Document uploaded', 'success')
      return res
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed'
      setError(message)
      throw err
    } finally {
      setLoading(false)
    }
  }, [pushToast])

  // Chat ingest
  const ingestText = useCallback(async (text: string) => {
    try {
      const res = await api.documents.ingest(text)
      return res
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ingest failed'
      setError(message)
      throw err
    }
  }, [])

  return (
    <StoreContext.Provider value={{
      auth, login, loginVerify, ownerSignup, userSignup, setupRecoveryQuestions, logout, enableTotp, disableTotp, updateProfile, changePassword, toasts, pushToast,
      sidebarCollapsed, toggleSidebar,
      createProject, updateProject, deleteProject, getProject, listProjects,
      running, startStageRun, endStageRun, runProjectStage, approveProject,
      totpCode, setTotpCode,
      recoveryCode, setRecoveryCode,
      loginChallenge, clearLoginChallenge,
      totpSetup, fetchTotpSetup,
      sessions, fetchSessions, revokeOtherSessions,
      securityEvents, fetchSecurityEvents,
      preferences, fetchPreferences, updatePreferences,
      uploadDocument,
      ingestText,
    }}>
      {children}
    </StoreContext.Provider>
  )
}

export function useStore() {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used within StoreProvider')
  return ctx
}





