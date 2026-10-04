import React, { useState, useEffect } from 'react'
import { Shell } from '../shell'
import { fmtDateTime, Status } from '../ui'
import { useStore } from '../store'
import { I } from '../icons2'
import { api, ApiCredentialRow } from '../api'

interface AttentionItem {
  id: string
  project: string
  projectRoute: string
  issue: string
  action: string
  actionRoute: string
  urgency: 'high' | 'medium' | 'low'
}

interface ProjectSummary {
  id: string
  title: string
  mode: string
  status: string
  lifecycleComplete: string | null
}

interface DashboardSummary {
  evidenceCount: number
  certified: boolean
  certifiedStamped: number
  masterPassed: boolean
  provider: string
  providerCalls: number
  project: { id: string; title: string; mode: string; lifecycleComplete: string | null }
}

export function Dashboard() {
  const { auth, listProjects } = useStore()
  const [loading, setLoading] = useState(true)
  const [activity, setActivity] = useState<Array<{ type: string; id: string; title: string; timestamp: string }>>([])
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [credentials, setCredentials] = useState<ApiCredentialRow[]>([])

  useEffect(() => {
    const loadDashboard = async () => {
      setLoading(true)
      try {
        const [projectsRes, activityRes, summaryRes, credsRes] = await Promise.all([
          api.projects.list(),
          api.dashboard.activity(),
          api.dashboard.summary(),
          api.credentials.list(),
        ])
        setProjects(projectsRes.projects)
        setActivity(activityRes.activity)
        setCredentials(credsRes.credentials)
        setSummary({
          evidenceCount: summaryRes.evidenceCount,
          certified: summaryRes.certified,
          certifiedStamped: summaryRes.certifiedStamped,
          masterPassed: summaryRes.masterPassed,
          provider: summaryRes.provider,
          providerCalls: summaryRes.providerCalls,
          project: summaryRes.project,
        })
      } catch (err) {
        console.error('Failed to load dashboard:', err)
      } finally {
        setLoading(false)
      }
    }
    loadDashboard()
  }, [])

  if (loading) return <Shell breadcrumb={[{ label: 'Dashboard' }]}><div className="loading-screen"><div className="spinner" /><div className="text-sm muted">Loading your workspace…</div></div></Shell>

  const active = projects.filter((p) => p.status === 'active').length
  const verifiedCredentials = credentials.filter((c) => c.verified).length

  // Attention items derived from live state.
  const attentionItems: AttentionItem[] = []
  if (verifiedCredentials === 0) {
    attentionItems.push({
      id: 'att_providers',
      project: 'Model selection',
      projectRoute: '#/projects',
      issue: 'No verified provider - open a project and pick a provider & model in the composer',
      action: 'Open a project',
      actionRoute: '#/projects',
      urgency: 'high',
    })
  }
  projects.forEach((p) => {
    if (p.status === 'active') {
      attentionItems.push({
        id: `att_${p.id}`,
        project: p.title,
        projectRoute: `#/projects/${p.id}`,
        issue: 'Active project - open it to run or review the next stage',
        action: 'Open project',
        actionRoute: `#/projects/${p.id}`,
        urgency: 'medium',
      })
    }
  })

  const attentionWeight: Record<string, number> = { high: 0, medium: 1, low: 2 }
  attentionItems.sort((a, b) => attentionWeight[a.urgency] - attentionWeight[b.urgency])

  return (
    <Shell breadcrumb={[{ label: 'Dashboard' }]}>
      <div className="page-head">
        <div><h1>Welcome back, {auth.fullName || auth.username || 'engineer'}</h1><p className="subtitle">Your blueprint-first engineering control center.</p></div>
        <a href="#/projects/new" className="btn btn-primary"><I name="plus" /> New project</a>
      </div>

      {/* First-time dashboard: no projects yet */}
      {projects.length === 0 && (
        <div className="card mb-16" style={{ borderColor: 'var(--green-200)', background: 'linear-gradient(135deg, var(--green-50), var(--surface))', textAlign: 'center', padding: '40px 20px' }}>
          <div style={{ fontSize: 34, marginBottom: 10 }}>&#128736;</div>
          <h3>Create your first project</h3>
          <p className="text-sm muted" style={{ maxWidth: 440, margin: '8px auto 16px' }}>A project is the unit of work. Describe what you want to build and NEXORA turns it into a blueprint you can review before engineering begins. Provider &amp; model are chosen inside each project's workspace composer.</p>
          <a href="#/projects/new" className="btn btn-primary">Create your first project</a>
        </div>
      )}

      {/* What needs your attention */}
      {attentionItems.length > 0 && (
        <div className="card mb-16" style={{ borderColor: 'var(--green-200)', background: 'linear-gradient(135deg, var(--green-50), var(--surface))' }}>
          <h3 className="mb-12"><I name="alert" size={16} /> What needs your attention</h3>
          <div style={{ display: 'grid', gap: 8 }}>
            {attentionItems.map((item) => (
              <a key={item.id} href={item.actionRoute} className="card card-hover row-between" style={{ display: 'flex', marginBottom: 0 }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{item.project}</div>
                  <div className="text-sm muted">{item.issue}</div>
                </div>
                <button className="btn btn-sm btn-outline">{item.action}</button>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* §1.1 — dashboard stats: Projects · Evidence records · Latest blueprint certified · Provider credentials */}
      <div className="grid grid-4 mb-24">
        <div className="stat-card accent"><div className="stat-label">Active projects</div><div className="stat-value">{active}</div><div className="stat-sub">{projects.length} total</div></div>
        <div className="stat-card"><div className="stat-label">Evidence records</div><div className="stat-value">{summary?.evidenceCount ?? 0}</div><div className="stat-sub">Across all projects</div></div>
        <div className="stat-card"><div className="stat-label">Latest blueprint certified</div>
          <div className="stat-value" style={{ fontSize: 20 }}>{summary?.certified ? 'Certified' : 'Not yet'}</div>
          <div className="stat-sub">{summary?.certified ? `Certification ready` : 'Run a design stage to start'}</div>
        </div>
        <div className="stat-card"><div className="stat-label">Provider credentials</div><div className="stat-value">{verifiedCredentials}</div><div className="stat-sub">Verified of {credentials.length}</div></div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="row-between mb-16"><h3>Your projects</h3><a href="#/projects" className="text-sm">View all</a></div>
          {projects.length === 0 ? (
            <p className="text-sm muted">No projects yet. Your projects appear here once you create one.</p>
          ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {projects.slice(0, 4).map((p) => (
              <a key={p.id} href={`#/projects/${p.id}`} className="card card-hover row-between" style={{ display: 'flex' }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{p.title}</div>
                  <div className="text-xs muted id-mono">{p.id}</div>
                  <div className="text-xs muted mt-4">{p.lifecycleComplete ? 'Complete' : 'In progress'} · {p.mode}</div>
                </div>
                <div className="row" style={{ gap: 10 }}><span className="badge badge-gray">{p.mode}</span><Status status={p.status} /></div>
              </a>
            ))}
          </div>
          )}
        </div>

        <div className="card">
          <h3 className="mb-16">Recent activity</h3>
          <div style={{ display: 'grid', gap: 10 }}>
            {activity.slice(0, 5).map((a) => (
              <div key={a.id} className="row" style={{ alignItems: 'flex-start', gap: 10 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--green-500)', marginTop: 6, flexShrink: 0 }} />
                <div><div className="text-sm" style={{ color: 'var(--ink-700)' }}>{a.title}</div><div className="text-xs muted">{fmtDateTime(a.timestamp)}</div></div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* AI status panel */}
      <div className="card mt-16">
        <h3 className="mb-12"><I name="cpu" size={16} /> AI provider status</h3>
        <div>
          {verifiedCredentials > 0 ? (
            <div className="row-between" style={{ alignItems: 'center' }}>
              <p className="text-sm muted mb-0">{verifiedCredentials} verified credential(s). {summary?.provider ? `Active provider used for lifecycle stages: ${summary.provider}` : 'Lifecycle stages run over the configured provider.'} · {summary?.providerCalls ?? 0} model call(s) recorded.</p>
              <span className="text-xs muted">Provider &amp; model per-project in the workspace composer.</span>
            </div>
          ) : (
            <>
              <p className="text-sm muted mb-12">No provider credential is verified yet. Open a project and add your provider key in the composer before running lifecycle stages.</p>
              <a href="#/projects" className="btn btn-primary">Open a project</a>
            </>
          )}
        </div>
      </div>

    </Shell>
  )
}