import React, { useState } from 'react'
import { Shell } from '../shell'
import { useStore } from '../store'
import { navigate } from '../router'
import { ProjectMode } from '../mock/data'
import { I } from '../icons2'
import { api, ApiProjectAiConfig } from '../api'
import { AiModelControl } from '../modelPopup'

const modes = [
  { id: 'design-only', title: 'Design only', tag: 'Explore & design', stages: ['Discovery', 'Design', 'Design Verification'], useCase: 'When you want to explore an idea and design it before any code.' },
  { id: 'design-plus-code', title: 'Design + code', tag: 'Design through verification', stages: ['Discovery', 'Design', 'Blueprint', 'Architecture', 'Implementation', 'Testing', 'Verification'], useCase: 'When you want a full engineering pipeline from design to verified code.' },
  { id: 'full-product', title: 'Full product', tag: 'Complete lifecycle', stages: ['Discovery', 'Design', 'Blueprint', 'Implementation', 'Testing', 'Verification', 'Deployment', 'Operations', 'Maintenance', 'Continuous Improvement'], useCase: 'When you want to operate and continuously improve a production system.' },
]

const ACCEPT = '.md,.txt,.markdown,.pdf,.text'

export function CreateProject() {
  const { pushToast, ingestText, uploadDocument, listProjects } = useStore()
  const [name, setName] = useState('')
  const [mode, setMode] = useState('')
  const [vision, setVision] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [attached, setAttached] = useState<{ id: string; title: string }[]>([])
  const [uploading, setUploading] = useState(false)
  const [aiConfig, setAiConfig] = useState<ApiProjectAiConfig | null>(null)

  const classification = vision.length >= 4000 ? 'document' : 'message'
  const charCount = vision.length

  const handleFiles = async (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return
    const f = files[0]
    setUploading(true)
    try {
      const res = await uploadDocument(f)
      setAttached(prev => [...prev, { id: res.document.id, title: res.document.preview.slice(0, 50) }])
      pushToast('Uploaded and attached - classified as ' + res.document.preview, 'success')
    } catch (err) {
      pushToast('Could not read that file - try a text, markdown, or PDF file', 'error')
    } finally {
      setUploading(false)
    }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (name.length < 2) { setError('Project name must be at least 2 characters.'); return }
    if (!mode) { setError('Please select a project mode.'); return }
    setError(''); setLoading(true)
    try {
      const visionDocumentId = attached.length > 0 ? attached[0].id : undefined
      const project = await api.projects.create(name, vision, mode, visionDocumentId, aiConfig)
      pushToast(aiConfig ? `Project created — starting the Blueprint-First pipeline through ${aiConfig.providerId}…` : 'Project created — starting the Blueprint-First pipeline…', 'success')
      navigate('#/projects/' + project.project.id)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create project'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Shell breadcrumb={[{ label: 'Projects', route: '#/projects' }, { label: 'New project' }]}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <h1 style={{ fontSize: 26, marginBottom: 6 }}>Create a project</h1>
        <p className="muted mb-24">Define your project identity, choose a mode, describe your vision, and optionally attach reference documents.</p>

        <form onSubmit={submit}>
          {error && <div style={{ padding: '10px 14px', borderRadius: 8, background: 'var(--danger-soft)', color: 'var(--danger)', fontSize: 13, marginBottom: 16 }}>{error}</div>}

          <div className="card mb-16">
            <h3 className="mb-12">Project name</h3>
            <div className="field" style={{ marginBottom: 0 }}>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Lumina Dashboard" maxLength={64} />
              <div className="char-count">{name.length}/64</div>
            </div>
          </div>

          <div className="card mb-16">
            <h3 className="mb-12">Project mode</h3>
            <p className="text-sm muted mb-12">Choose the lifecycle scope for this project.</p>
            <div className="mode-cards">
              {modes.map(m => (
                <div key={m.id} className={`mode-card ${mode === m.id ? 'selected' : ''}`} onClick={() => setMode(m.id)}>
                  <h4>{m.title}</h4>
                  <div className="mode-tag">{m.tag}</div>
                  <ul>{m.stages.map((s, i) => <li key={i}>{s}</li>)}</ul>
                  <p className="text-xs muted mt-8">{m.useCase}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="card mb-16">
            <h3 className="mb-12">Vision / intent</h3>
            <p className="text-sm muted mb-12">Describe what you want to build. This becomes the foundation for discovery.</p>
            <div className="field" style={{ marginBottom: 8 }}>
              <textarea value={vision} onChange={e => setVision(e.target.value)} rows={5} placeholder="Describe your idea, its goals, and the problem it solves…" />
              <div className={`char-count ${charCount >= 7500 ? 'char-count-warn' : ''}`}>{charCount.toLocaleString()} / 8,000 characters</div>
            </div>
            <div className={`text-sm ${classification === 'document' ? 'green' : 'muted'}`}>
              {charCount === 0 ? 'Start typing to see classification.' : classification === 'document' ? '✓ This vision will be stored as a document reference (8,000+ characters).' : 'This will stay inline as a message (under 8,000 characters).'}
            </div>
            {charCount >= 7500 && charCount <= 8000 && <div className="text-xs" style={{ color: 'var(--warning)', marginTop: 4 }}>You are near the 8,000-character limit. Above it the vision is stored as a document reference.</div>}
          </div>

          {/* Reference attachments */}
          <div className="card mb-16">
            <h3 className="mb-12">Reference documents <span className="badge badge-gray">Optional</span></h3>
            <p className="text-sm muted mb-12">Attach one or more documents as reference material for the idea. They remain standalone library items and become this project's linked documents.</p>

            {attached.length > 0 && (
              <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
                {attached.map(a => (
                  <div key={a.id} className="row-between text-sm" style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--surface-2)' }}>
                    <span><a href={`#/documents/${a.id}`} style={{ fontWeight: 600 }}>{a.title}</a> <span className="id-mono text-xs muted">{a.id}</span></span>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAttached(prev => prev.filter(x => x.id !== a.id))}><I name="close" size={14} /> Remove</button>
                  </div>
                ))}
              </div>
            )}

            <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
              <div
                className="drop-zone"
                style={{ flex: 1, minWidth: 240, padding: '18px 14px', borderRadius: 12, border: '2px dashed var(--border)', background: 'var(--surface-2)', textAlign: 'center', cursor: 'pointer', fontWeight: 600, fontSize: 13, color: 'var(--ink-700)' }}
                onClick={() => document.getElementById('create-doc-file')?.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); handleFiles(e.dataTransfer?.files) }}
              >
                <div style={{ fontSize: 20, marginBottom: 4 }}>&#128196;</div>
                {uploading ? 'Processing file…' : 'Upload a new document'}
                <div className="text-xs muted" style={{ marginTop: 2 }}>Markdown, text, or PDF</div>
                <input id="create-doc-file" type="file" style={{ display: 'none' }} accept={ACCEPT} onChange={e => handleFiles(e.target.files)} />
              </div>
            </div>
          </div>

          {/* AI model (Optional) */}
          <div className="card mb-16">
            <h3 className="mb-12">AI model <span className="badge badge-gray">Optional</span></h3>
            <p className="text-sm muted mb-12">Pin the provider and model that will run this project's pipeline. When bound to a verified key, discovery starts automatically on creation. Skip this to create the project unconfigured — the AI model is set anytime from the project's AI MODEL control.</p>
            <AiModelControl value={aiConfig} onChange={setAiConfig} />
          </div>

          <div className="row" style={{ justifyContent: 'flex-end', gap: 12 }}>
            <button className="btn btn-ghost" type="button" onClick={() => navigate('#/projects')}>Cancel</button>
            <button className="btn btn-primary btn-lg" disabled={loading}>
              {loading ? <><span className="spin" style={{ width: 16, height: 16, border: '2px solid #fff', borderTopColor: 'transparent', borderRadius: '50%', display: 'inline-block' }} /> Creating…</> : 'Create project'}
            </button>
          </div>
        </form>
      </div>
    </Shell>
  )
}