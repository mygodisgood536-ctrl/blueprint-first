import React, { useState, useEffect } from 'react'
import { Shell } from '../shell'
import { useStore } from '../store'
import { Modal } from '../ui'
import { I } from '../icons2'
import { navigate } from '../router'

/* Project settings (§16.4/§18) — General (name, mode, description with
   §80.6 8,000-character limit), Linked documents, and the complete
   deletion experience from §80.2. */

const LIMIT = 8000

function ProjectDeletedState() {
  return (
    <div className="card" style={{ textAlign: 'center', padding: '48px 24px' }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>&#128465;&#65039;</div>
      <h2 style={{ marginBottom: 6 }}>Project not found</h2>
      <p className="muted text-sm" style={{ marginBottom: 20 }}>This project was deleted. Its uploaded documents remain in your library.</p>
      <div className="row" style={{ justifyContent: 'center', gap: 10 }}>
        <a href="#/projects" className="btn btn-primary">Back to projects</a>
        <a href="#/documents" className="btn btn-ghost">View documents</a>
      </div>
    </div>
  )
}

export function ProjectSettings({ id }: { id: string }) {
  const { pushToast, getProject, updateProject, deleteProject, running } = useStore()
  const [project, setProject] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [mode, setMode] = useState('')
  const [saved, setSaved] = useState(false)
  const [delOpen, setDelOpen] = useState(false)
  const [confirmName, setConfirmName] = useState('')
  const [delError, setDelError] = useState('')
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    const loadProject = async () => {
      try {
        const p = await getProject(id)
        setProject(p)
      } catch (err) {
        console.error('Failed to load project:', err)
      } finally {
        setLoading(false)
      }
    }
    loadProject()
  }, [id])

  const descCount = description.length
  if (loading) return <Shell breadcrumb={[{ label: 'Projects', route: '#/projects' }, { label: 'Loading...' }]}><div className="loading-screen"><div className="spinner" /></div></Shell>
  if (!project) {
    return (
      <Shell breadcrumb={[{ label: 'Projects', route: '#/projects' }, { label: 'Not found' }, { label: 'Settings' }]}>
        <ProjectDeletedState />
      </Shell>
    )
  }

  const recordedCount = project.stages.filter((s: any) => s.status === 'RECORDED').length
  const isRunning = running?.projectId === id

  const save = () => {
    if (!name.trim()) { pushToast('Project name cannot be empty', 'error'); return }
    void updateProject(id, {
      name: name.trim(),
      description: description.trim(),
      mode: mode as any,
    }).then(() => {
      setSaved(true); pushToast('Settings saved', 'success'); setTimeout(() => setSaved(false), 2000)
    }).catch(() => pushToast('Failed to save settings', 'error'))
  }

  const performDelete = async () => {
    setDeleting(true); setDelError('')
    await new Promise(r => setTimeout(r, 500))
    const existed = deleteProject(id)
    if (!existed) {
      setDelError('Something went wrong deleting the project. It still exists — try again.')
      setDeleting(false)
      return
    }
    setDeleting(false); setDelOpen(false)
    pushToast('Project deleted', 'success')
    navigate('#/projects')
  }

  const canConfirmDelete = recordedCount >= 1 ? confirmName.trim() === project.name : true

  return (
    <Shell breadcrumb={[{ label: 'Projects', route: '#/projects' }, { label: project.name, route: `#/projects/${id}` }, { label: 'Settings' }]}>
      <a href={`#/projects/${id}`} className="back-link" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 16 }}><I name="arrowLeft" size={14} /> Back to project</a>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <div className="page-head">
          <div><h1>Settings: {project.name}</h1><p className="subtitle id-mono">{project.id}</p></div>
        </div>

        <div className="card mb-16">
          <h3 className="mb-12">General</h3>
          <div className="field"><label>Project name</label><input value={name} onChange={e => setName(e.target.value)} placeholder="Project name" maxLength={64} />
            <div className="char-count">{name.length}/64</div></div>
          <div className="field mt-12"><label>Description</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} placeholder="Optional description" maxLength={LIMIT} />
            <div className={`char-count ${descCount >= LIMIT - 500 ? 'char-count-warn' : ''}`}>{descCount.toLocaleString()} / {LIMIT.toLocaleString()} characters</div></div>
          <div className="field mt-12"><label>Mode</label>
            <select value={mode} onChange={e => setMode(e.target.value)}>
              <option value="design-only">Design only</option>
              <option value="design-plus-code">Design + code</option>
              <option value="full-product">Full product</option>
            </select>
            {mode !== project.mode && <p className="text-xs warning-text mt-4">Changing mode updates which lifecycle stages are in scope for this project.</p>}</div>
          <div className="row mt-16" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn btn-ghost" onClick={() => { setName(project.name); setDescription(project.description); setMode(project.mode); pushToast('Changes discarded', 'info') }}>Discard</button>
            <button className="btn btn-primary" onClick={save} disabled={saved}>{saved ? 'Saved' : 'Save settings'}</button>
          </div>
        </div>

        <div className="card mb-16">
          <h3 className="mb-12">Linked documents <span className="badge badge-gray">Optional</span></h3>
          <p className="text-sm muted mb-12">Documents are bound to a project at creation, as its vision document. The API does not support attaching or unlinking documents after creation.</p>
          {project.config && Array.isArray(project.config.visionDocumentIds)
            ? ((project.config.visionDocumentIds as string[]).length > 0 ? (
                <div style={{ display: 'grid', gap: 8 }}>
                  {(project.config.visionDocumentIds as string[]).map((did) => (
                    <div key={did} className="row-between text-sm" style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--surface-2)' }}>
                      <span><a href={`#/documents/${did}`} style={{ fontWeight: 600 }}>Vision document</a> <span className="id-mono text-xs muted">{did}</span></span>
                    </div>
                  ))}
                </div>
              ) : <p className="text-sm muted">No linked documents.</p>)
            : <p className="text-sm muted">No linked documents.</p>}
        </div>

        <div className="card panel--danger">
          <h3 className="mb-12"><I name="trash" size={16} /> Delete project</h3>
          <p className="text-sm muted mb-12">Deleting this project removes it from your workspace. Linked documents remain in your library. This cannot be undone.</p>
          {!delOpen ? (
            <button className="btn btn-danger" onClick={() => setDelOpen(true)}>Delete project</button>
          ) : (
            <div className="mt-12">
              {recordedCount >= 1 && (
                <div className="card warn-card" style={{ marginBottom: 12 }}>
                  <p className="text-sm">This project has <strong>{recordedCount}</strong> recorded stage(s). To confirm deletion, type the project name exactly.</p>
                  <input value={confirmName} onChange={e => setConfirmName(e.target.value)} placeholder="Type project name to confirm" className="mt-8" style={{ width: '100%' }} />
                </div>
              )}
              <div className="row" style={{ gap: 8 }}>
                <button className="btn btn-danger" onClick={performDelete} disabled={deleting || !canConfirmDelete}>{deleting ? 'Deleting…' : 'Confirm deletion'}</button>
                <button className="btn btn-ghost" onClick={() => { setDelOpen(false); setConfirmName(''); setDelError('') }}>Cancel</button>
              </div>
              {delError && <p className="text-sm mt-8" style={{ color: 'var(--danger)' }}>{delError}</p>}
            </div>
          )}
        </div>
      </div>
    </Shell>
  )
}