import { useState, useCallback, createContext, useContext, ReactNode, useEffect } from 'react'
import { navigate } from './router'
import { Project, ProjectMode, stagesForMode, StageId, StageStatus } from './mock/data'
import { api } from './api'

interface Toast { id: number; message: string; type: 'success' | 'error' | 'info' }

/**
 * Authentication state.
 *
 * The ONLY credential on this platform is the security question + answer pair,
 * proven against a Gmail address. There is no password, OTP, authenticator,
 * recovery code or email verification - so none of them appears in this state.
 *
 * `canManagePlatform` is ADVISORY. It mirrors a server decision so the UI can
 * choose what to render; it is never what protects a privileged resource. The
 * server refuses those routes independently, and the HTTP tests prove it.
 */
interface AuthState {
  authenticated: boolean
  id: string
  fullName: string
  username: string
  gmail: string
  securityQuestion: string
  role: 'member' | 'administrator'
  createdAt: string
  canManagePlatform: boolean
}

/** The single public sign-up contract: five fields, nothing else. */
export interface SignupFields {
  fullName: string
  username: string
  gmail: string
  securityQuestion: string
  securityAnswer: string
}

/** The single public sign-in contract: three fields, nothing else. */
export interface LoginFields {
  gmail: string
  securityQuestion: string
  securityAnswer: string
}

function authFromAccount(
  account: {
    id: string
    fullName: string
    username: string
    gmail: string
    securityQuestion: string
    role: 'member' | 'administrator'
    createdAt: string
  },
  canManagePlatform: boolean,
): AuthState {
  return {
    authenticated: true,
    id: account.id,
    fullName: account.fullName,
    username: account.username,
    gmail: account.gmail,
    securityQuestion: account.securityQuestion,
    role: account.role,
    createdAt: account.createdAt,
    canManagePlatform,
  }
}

const ANONYMOUS: AuthState = {
  authenticated: false,
  id: '',
  fullName: '',
  username: '',
  gmail: '',
  securityQuestion: '',
  role: 'member',
  createdAt: '',
  canManagePlatform: false,
}

interface StoreContextType {
  auth: AuthState
  /** Creates an account. Issues NO session - the caller must then sign in. */
  signup: (fields: SignupFields) => Promise<{ ok: boolean; reason: string }>
  /** The one sign-in route, used by every account including the privileged one. */
  login: (fields: LoginFields) => Promise<{ ok: boolean; reason: string }>
  logout: () => Promise<void>
  updateProfile: (fullName: string) => Promise<void>
  securityQuestions: string[]
  loadSecurityQuestions: () => Promise<void>
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
  preferences: Record<string, unknown>
  fetchPreferences: () => Promise<void>
  updatePreferences: (preferences: Record<string, unknown>) => Promise<void>
  uploadDocument: (file: File) => Promise<{ document: { id: string; preview: string; charLength: number; byteLength: number; contentHash: string }; fileName: string | null }>
  ingestText: (text: string) => Promise<{ kind: 'message' | 'document'; message?: string; charLength?: number; documentRef?: { id: string; ownerId: string; charLength: number; byteLength: number; preview: string; contentHash: string; createdAt: string } }>
}

const StoreContext = createContext<StoreContextType | null>(null)

let toastId = 0
export function StoreProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthState>(ANONYMOUS)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [projects, setProjects] = useState<Project[]>([])
  const [running, setRunning] = useState<{ projectId: string; stage: string } | null>(null)
  const [preferences, setPreferences] = useState<Record<string, unknown>>({})
  const [securityQuestions, setSecurityQuestions] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pushToast = useCallback((message: string, type: Toast['type'] = 'info') => {
    const id = ++toastId
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500)
  }, [])

  const loadSecurityQuestions = useCallback(async () => {
    try {
      const res = await api.auth.securityQuestions()
      setSecurityQuestions(res.questions)
    } catch {
      setSecurityQuestions([])
    }
  }, [])

  // The session is a server-resolved HttpOnly cookie. We ask the server who we
  // are; we never decide it here and never keep a copy of any credential.
  useEffect(() => {
    let alive = true
    const initAuth = async () => {
      try {
        const res = await api.auth.session()
        if (!alive) return
        setAuth(res.account ? authFromAccount(res.account, res.canManagePlatform) : ANONYMOUS)
      } catch {
        if (alive) setAuth(ANONYMOUS)
      }
      void loadSecurityQuestions()
    }
    void initAuth()
    return () => { alive = false }
  }, [loadSecurityQuestions])

  const signup = useCallback(async (fields: SignupFields): Promise<{ ok: boolean; reason: string }> => {
    setLoading(true)
    setError(null)
    try {
      await api.auth.signup({
        fullName: fields.fullName.trim(),
        username: fields.username.trim(),
        gmail: fields.gmail.trim(),
        securityQuestion: fields.securityQuestion,
        securityAnswer: fields.securityAnswer,
      })
      // Sign-up deliberately returns NO session, so we stay anonymous here and
      // send the user to sign in rather than pretending they are logged in.
      pushToast('Account created - sign in to continue', 'success')
      return { ok: true, reason: '' }
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'That account could not be created.'
      setError(reason)
      return { ok: false, reason }
    } finally {
      setLoading(false)
    }
  }, [pushToast])

  const login = useCallback(async (fields: LoginFields): Promise<{ ok: boolean; reason: string }> => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.auth.login({
        gmail: fields.gmail.trim(),
        securityQuestion: fields.securityQuestion,
        securityAnswer: fields.securityAnswer,
      })
      setAuth(authFromAccount(res.account, res.canManagePlatform))
      pushToast('Welcome back', 'success')
      return { ok: true, reason: '' }
    } catch (err) {
      // One generic message for every failure, so the form cannot be used to
      // discover which Gmail addresses exist.
      const reason = err instanceof Error ? err.message : 'Those details did not match an account.'
      setError(reason)
      return { ok: false, reason }
    } finally {
      setLoading(false)
    }
  }, [pushToast])

  const logout = useCallback(async () => {
    try {
      await api.auth.logout()
    } catch { /* the local session is cleared regardless */ }
    setAuth(ANONYMOUS)
    setProjects([])
    navigate('#/welcome')
    pushToast('You have been signed out', 'info')
  }, [pushToast])

  const updateProfile = useCallback(async (fullName: string) => {
    setLoading(true)
    try {
      const res = await api.auth.updateProfile(fullName.trim())
      setAuth(a => ({ ...a, fullName: res.account.fullName }))
      pushToast('Profile updated', 'success')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update profile'
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
      auth, signup, login, logout, updateProfile,
      securityQuestions, loadSecurityQuestions,
      toasts, pushToast,
      sidebarCollapsed, toggleSidebar,
      createProject, updateProject, deleteProject, getProject, listProjects,
      running, startStageRun, endStageRun, runProjectStage, approveProject,
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
