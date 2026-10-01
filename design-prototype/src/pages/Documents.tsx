import React, { useState, useEffect } from 'react'
import { Shell } from '../shell'
import { useStore } from '../store'
import { useConfirm, fmtDate, fmtBytes, Modal } from '../ui'
import { I } from '../icons2'
import { navigate } from '../router'
import { api } from '../api'

interface DocumentRef {
  id: string
  ownerId: string
  charLength: number
  byteLength: number
  preview: string
  contentHash: string
  content?: string
  classification?: string
  title?: string
  createdAt?: string
}

export function DocumentsList() {
  const { pushToast, uploadDocument, ingestText } = useStore()
  const [loading, setLoading] = useState(true)
  const [docs, setDocs] = useState<DocumentRef[]>([])
  const [search, setSearch] = useState('')
  const [showUpload, setShowUpload] = useState(false)
  const [fileName, setFileName] = useState('')
  const [fileContent, setFileContent] = useState('')
  const [dragOver, setDragOver] = useState(false)

  useEffect(() => {
    const loadDocs = async () => {
      try {
        const res = await api.documents.list()
        setDocs(res.documents)
      } catch (err) {
        console.error('Failed to load documents:', err)
      } finally {
        setLoading(false)
      }
    }
    loadDocs()
  }, [])

  const filtered = docs.filter((d) => !search || (d.title || '').toLowerCase().includes(search.toLowerCase()) || d.id.toLowerCase().includes(search.toLowerCase()))

  const handleFiles = (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return
    const f = files[0]
    setFileName(f.name)
    const reader = new FileReader()
    reader.onload = () => setFileContent(reader.result as string)
    reader.onerror = () => pushToast('Could not read that file - try a text, markdown, or PDF file', 'error')
    reader.readAsText(f)
  }

  const saveUpload = async () => {
    if (!fileName) { pushToast('Choose a file first', 'error'); return }
    const file = new File([fileContent], fileName, { type: 'text/plain' })
    try {
      await uploadDocument(file)
      pushToast('Document uploaded & stored', 'success')
      setShowUpload(false)
      setFileName('')
      setFileContent('')
      // Reload documents
      const docsRes = await api.documents.list()
      setDocs(docsRes.documents)
    } catch (err) {
      pushToast('Upload failed', 'error')
    }
  }

  if (loading) return <Shell breadcrumb={[{ label: 'Documents' }]}><div className="loading-screen"><div className="spinner" /></div></Shell>

  return (
    <Shell breadcrumb={[{ label: 'Documents' }]}>
      <Modal open={showUpload} onClose={() => { setShowUpload(false); setFileName(''); setFileContent('') }} title="Upload document"
        footer={<><button className="btn btn-ghost" onClick={() => { setShowUpload(false); setFileName(''); setFileContent('') }}>Cancel</button>
          <button className="btn btn-primary" onClick={saveUpload} disabled={!fileName}>Upload & classify</button></>}>
        <div
          className="drop-zone"
          style={{
            padding: '28px 16px', borderRadius: 12, border: `2px dashed ${dragOver ? 'var(--green-500)' : 'var(--border)'}`,
            background: dragOver ? 'var(--green-50)' : 'var(--surface-2)', color: dragOver ? 'var(--green-700)' : 'var(--ink-700)',
            textAlign: 'center', cursor: 'pointer', fontWeight: 600, fontSize: 14,
          }}
          onClick={() => document.getElementById('doc-file-input')?.click()}
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer?.files) }}
        >
          <div style={{ fontSize: 26, marginBottom: 6 }}>&#128196;</div>
          Drag & drop a file here, or click to browse
          <div className="text-xs muted">Markdown, text, or PDF. In chat, inputs at or above the {(4000).toLocaleString()}-character threshold are classified as documents; uploaded files are always stored as document references.</div>
          <input id="doc-file-input" type="file" style={{ display: 'none' }} accept=".md,.txt,.markdown,.pdf,.text" onChange={e => handleFiles(e.target.files)} />
        </div>
        {fileName && (
          <div className="card mt-12" style={{ marginBottom: 0 }}>
            <div className="row-between text-sm"><span><strong>{fileName}</strong></span><span>{fmtBytes(fileContent ? new Blob([fileContent]).size : 0)}</span></div>
            <div className="text-sm mt-8">
              Character count: <strong>{fileContent.length}</strong>
              <span className="badge badge-green" style={{ marginLeft: 8 }}>document</span>
            </div>
            <p className="text-xs muted mt-8">Uploads are stored as document references. In chat, inputs at or above the {(4000).toLocaleString()}-character threshold are classified as documents; everything else stays an inline message.</p>
          </div>
        )}
      </Modal>
      <div className="page-head"><div><h1>Documents</h1><p className="subtitle">{docs.length} documents in your workspace.</p></div>
        <button className="btn btn-primary" onClick={() => setShowUpload(true)}><I name="plus" /> Upload</button></div>
      <div className="card mb-16"><input placeholder="Search documents..." value={search} onChange={e => setSearch(e.target.value)} style={{ width: '100%', padding: '10px 14px', border: '1px solid var(--border)', borderRadius: 10, outline: 'none' }} /></div>
      {filtered.length === 0 ? <div className="empty-state"><div className="empty-icon">&#128196;</div><h3>No documents</h3><p>A document is source material for your blueprint - a vision statement, spec, or reference. Upload one to get started.</p></div> : (
        <div className="table-wrap"><table className="data"><thead><tr><th>Title</th><th>Type</th><th>Size</th><th>Classification</th><th>Created</th></tr></thead>
          <tbody>{filtered.map((d) => (
            <tr key={d.id}><td><a href={`#/documents/${d.id}`} style={{ fontWeight: 600 }}>{d.preview.slice(0, 60)}</a><div className="text-xs muted id-mono">{d.id}</div></td>
              <td><span className="badge badge-gray">ingest</span></td><td>{fmtBytes(d.byteLength)}</td>
              <td><span className="badge badge-green">document</span></td>
              <td className="text-sm muted">{d.createdAt ? fmtDate(d.createdAt) : '—'}</td></tr>
          ))}</tbody></table></div>
      )}
    </Shell>
  )
}

export function DocumentDetail({ id }: { id: string }) {
  const { pushToast } = useStore()
  const { confirm, node } = useConfirm()
  const [loading, setLoading] = useState(true)
  const [doc, setDoc] = useState<DocumentRef | null>(null)

  useEffect(() => {
    const loadDoc = async () => {
      try {
        const res = await api.documents.get(id, true)
        setDoc(res)
      } catch (err) {
        console.error('Failed to load document:', err)
      } finally {
        setLoading(false)
      }
    }
    loadDoc()
  }, [id])

  if (loading) return <Shell breadcrumb={[{ label: 'Documents', route: '#/documents' }, { label: 'Loading...' }]}><div className="loading-screen"><div className="spinner" /></div></Shell>
  if (!doc) {
    return (
      <Shell breadcrumb={[{ label: 'Documents', route: '#/documents' }, { label: 'Not found' }]}>
        <div className="empty-state"><div className="empty-icon">&#128196;</div><h3>Document not found</h3><p>It may have been deleted from another session.</p>
          <a href="#/documents" className="btn btn-primary mt-12">Back to documents</a></div>
      </Shell>
    )
  }

  const del = async () => {
    try {
      await api.documents.delete(id)
      pushToast('Document deleted', 'info')
      navigate('#/documents')
    } catch {
      pushToast('Failed to delete document', 'error')
    }
  }

  const copyHash = () => {
    try { navigator.clipboard.writeText(doc.contentHash || ''); pushToast('Content hash copied', 'success') }
    catch { pushToast('Could not copy to clipboard', 'error') }
  }
  const copyContent = () => {
    try { navigator.clipboard.writeText(doc.content || ''); pushToast('Full content copied', 'success') }
    catch { pushToast('Could not copy to clipboard', 'error') }
  }
  const download = () => {
    try {
      const blob = new Blob([doc.content || ''], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = (doc.preview || 'document') + '.txt'
      document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(url)
      pushToast('Download started', 'success')
    } catch { pushToast('Could not start the download', 'error') }
  }

  const lines = (doc.content || '').split('\n')
  const preview = (doc.content || '').slice(0, 600)
  const charCount = (doc.content || '').length

  return (
    <Shell breadcrumb={[{ label: 'Documents', route: '#/documents' }, { label: doc.preview.slice(0, 40) }]}>
      {node}
      <a href="#/documents" className="back-link" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 16 }}><I name="arrowLeft" size={14} /> Back to documents</a>
      <div className="page-head"><div><h1>{doc.preview.slice(0, 60)}</h1><p className="subtitle id-mono">{doc.id}</p></div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-ghost" onClick={download}><I name="arrowRight" size={14} /> Download .txt</button>
          <button className="btn btn-danger" onClick={() => confirm('Delete document', `Are you sure you want to delete "${doc.preview.slice(0, 40)}"? Projects that reference it will keep their current state. This cannot be undone.`, del, 'Delete')}><I name="trash" /> Delete</button>
        </div></div>
      <div className="grid grid-2">
        <div className="card"><h4 className="mb-12">Identity</h4>
          <div style={{ display: 'grid', gap: 8 }}>
            <div className="row-between text-sm"><span className="muted">Type</span><span className="badge badge-gray">ingest</span></div>
            <div className="row-between text-sm"><span className="muted">Size</span>{fmtBytes(doc.byteLength)}</div>
            <div className="row-between text-sm"><span className="muted">Characters</span>{charCount.toLocaleString()}</div>
            <div className="row-between text-sm"><span className="muted">Classification</span><span className="badge badge-green">document</span></div>
            <div className="row-between text-sm"><span className="muted">Created</span>{doc.createdAt ? fmtDate(doc.createdAt) : '—'}</div>
            <div className="text-sm"><span className="muted">Content hash</span>
              <div className="row" style={{ gap: 8, marginTop: 4 }}>
                <code className="id-mono text-xs" style={{ background: 'var(--surface-2)', padding: '6px 10px', borderRadius: 6, wordBreak: 'break-all', flex: 1 }}>{doc.contentHash || 'not recorded'}</code>
                {doc.contentHash && <button className="btn btn-ghost btn-sm" onClick={copyHash}>Copy</button>}
              </div></div>
          </div></div>
        <div className="card"><h4 className="mb-12">Preview</h4>
          <div style={{ padding: 16, background: 'var(--bg)', borderRadius: 10, fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--ink-600)', minHeight: 120, maxHeight: 220, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
            {preview}{charCount > 600 ? '\n…' : ''}
          </div>
          {charCount > 600 && <p className="text-xs muted mt-8">Bounded preview — the first 600 characters. The full content is below.</p>}
        </div>
      </div>

      <div className="card mt-16">
        <div className="row-between mb-8">
          <h4>Full content</h4>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-ghost btn-sm" onClick={copyContent}>Copy content</button>
            <span className="text-xs muted">{lines.length} line(s)</span>
          </div>
        </div>
        {doc.content ? (
          <div style={{ display: 'flex', background: 'var(--bg)', borderRadius: 10, maxHeight: 420, overflow: 'auto', fontFamily: 'var(--mono)', fontSize: 12 }}>
            <div aria-hidden="true" style={{ padding: '12px 8px', textAlign: 'right', color: 'var(--ink-400)', userSelect: 'none', borderRight: '1px solid var(--border)', position: 'sticky', left: 0, background: 'var(--bg)' }}>
              {lines.map((_: string, i: number) => <div key={i} style={{ lineHeight: '20px' }}>{i + 1}</div>)}
            </div>
            <pre style={{ margin: 0, padding: 12, color: 'var(--ink-700)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', flex: 1 }}>
              {doc.content}
            </pre>
          </div>
        ) : (
          <p className="text-sm muted">Full content is not available for this document. Uploaded document references store their content through the document store.</p>
        )}
      </div>

      <div className="card mt-16">
        <h4 className="mb-8">Where this document is referenced</h4>
        <p className="text-sm muted">Document references live in chat/project state. The API exposes documents for a user but not a reverse index of every place a document is used — check the project workspace to see which documents a project is bound to.</p>
      </div>
    </Shell>
  )
}