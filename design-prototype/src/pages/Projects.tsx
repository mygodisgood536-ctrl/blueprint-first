import React, { useState, useEffect } from 'react'
import { Shell } from '../shell'
import { useStore } from '../store'
import { Status, fmtDate } from '../ui'
import { I } from '../icons2'
import { api } from '../api'

interface ProjectSummary {
  id: string
  title: string
  mode: string
  status: string
  lifecycleComplete: string | null
}

export function ProjectsList() {
  const { listProjects } = useStore()
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [modeFilter, setModeFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sortKey, setSortKey] = useState<'activity' | 'created' | 'name'>('activity')
  const [projects, setProjects] = useState<ProjectSummary[]>([])

  useEffect(() => {
    const loadProjects = async () => {
      setLoading(true)
      try {
        const res = await api.projects.list()
        setProjects(res.projects)
      } catch (err) {
        console.error('Failed to load projects:', err)
      } finally {
        setLoading(false)
      }
    }
    loadProjects()
  }, [])

  const filtered = projects.filter((p) => {
    if (modeFilter !== 'all' && p.mode !== modeFilter) return false
    if (statusFilter !== 'all' && p.status !== statusFilter) return false
    if (search && !p.title.toLowerCase().includes(search.toLowerCase()) && !p.id.includes(search)) return false
    return true
  }).sort((x, y) => {
    if (sortKey === 'name') return String(x.title).localeCompare(String(y.title))
    if (sortKey === 'created') return String(x.id).localeCompare(String(y.id))
    return String(y.lifecycleComplete || '').localeCompare(String(x.lifecycleComplete || ''))
  })

  if (loading) return <Shell breadcrumb={[{ label: 'Projects' }]}><div className="loading-screen"><div className="spinner" /></div></Shell>

  return (
    <Shell breadcrumb={[{ label: 'Projects' }]}>
      <div className="page-head">
        <div><h1>Projects</h1><p className="subtitle">{projects.length} projects in your workspace.</p></div>
        <a href="#/projects/new" className="btn btn-primary"><I name="plus" /> New project</a>
      </div>

      <div className="card mb-16">
        <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
          <div className="grow" style={{ minWidth: 200 }}><input placeholder="Search by name or ID…" value={search} onChange={e => setSearch(e.target.value)} style={{ width: '100%', padding: '10px 14px', border: '1px solid var(--border)', borderRadius: 10, outline: 'none' }} /></div>
          <select value={modeFilter} onChange={e => setModeFilter(e.target.value)} style={{ padding: '10px 14px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)' }}>
            <option value="all">All modes</option>
            <option value="design-only">Design only</option>
            <option value="design-plus-code">Design + code</option>
            <option value="full-product">Full product</option>
          </select>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ padding: '10px 14px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)' }}>
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
          </select>
          <select value={sortKey} onChange={e => setSortKey(e.target.value as any)} style={{ padding: '10px 14px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)' }} aria-label="Sort projects">
            <option value="activity">Sort: last activity</option>
            <option value="created">Sort: created</option>
            <option value="name">Sort: name</option>
          </select>
        </div>
      </div>

      {projects.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">📁</div>
          <h3>Start a project to open the workspace composer</h3>
          <p>Provider and model selection live inside each project's workspace — open a project and you'll find the <strong>[ Provider • Model ▼ ]</strong> control at the bottom of the instruction composer.</p>
          <a href="#/projects/new" className="btn btn-primary mt-12">Create your first project</a>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state"><div className="empty-icon">📁</div><h3>No projects found</h3><p>Try adjusting your search or filter.</p></div>
      ) : (
        <div className="grid grid-3">
          {filtered.map((p) => (
            <a key={p.id} href={`#/projects/${p.id}`} className="card card-hover" style={{ display: 'block' }}>
              <div className="row-between mb-8"><Status status={p.status} /><span className="badge badge-gray">{p.mode}</span></div>
              <h4 style={{ marginBottom: 4 }}>{p.title}</h4>
              <div className="text-xs muted id-mono mb-8">{p.id}</div>
              <p className="text-sm muted mb-12" style={{ minHeight: 38 }}>Project in {p.mode} mode</p>
              <div style={{ height: 6, borderRadius: 3, background: 'var(--border)', overflow: 'hidden' }}>
                <div style={{ width: p.lifecycleComplete ? '100%' : '0%', height: '100%', background: 'var(--green-500)' }} />
              </div>
              <div className="row-between mt-8">
                <span className="text-xs muted">{p.lifecycleComplete ? 'Complete' : 'In progress'}</span>
                <span className="text-xs muted">Last activity {fmtDate(p.lifecycleComplete || '')}</span>
              </div>
              <div className="row mt-8" style={{ gap: 6 }}>
                <span className="btn btn-ghost btn-sm" style={{ pointerEvents: 'none' }}>Open</span>
                <a href={`#/projects/${p.id}/settings`} className="btn btn-ghost btn-sm">Settings</a>
              </div>
            </a>
          ))}
        </div>
      )}
    </Shell>
  )
}