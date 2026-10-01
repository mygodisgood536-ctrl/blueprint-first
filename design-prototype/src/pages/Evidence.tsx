import React, { useState, useEffect } from 'react'
import { Shell } from '../shell'
import { artifactsApi, evidenceApi } from '../api'
import { fmtDateTime, Status } from '../ui'
import { I } from '../icons2'

/* Evidence (§26) — recorded verification & certification state.
   List: filterable by kind, table of real EvidenceLog records.
   Detail: identity, linked artifacts, producer. */

const KINDS = [
  'all',
  'command-output',
  'test-run',
  'review',
  'inspection',
  'metric',
  'external-response',
]

export function EvidenceList() {
  const [loading, setLoading] = useState(true)
  const [evidence, setEvidence] = useState<any[]>([])
  const [kindFilter, setKindFilter] = useState('all')

  useEffect(() => {
    evidenceApi.list().then((res: any) => {
      setEvidence(res.entries || [])
      setLoading(false)
    }).catch(() => { setEvidence([]); setLoading(false) })
  }, [])

  const filtered = evidence.filter((e: any) => {
    if (kindFilter !== 'all' && e.kind !== kindFilter) return false
    return true
  })

  if (loading) return <Shell breadcrumb={[{ label: 'Evidence' }]}><div className="loading-screen"><div className="spinner" /></div></Shell>
  return (
    <Shell breadcrumb={[{ label: 'Evidence' }]}>
      <div className="page-head"><div><h1>Evidence</h1><p className="subtitle">The reasoning, decisions, and verifications behind every artifact.</p></div></div>
      <div className="card mb-16">
        <div className="row" style={{ gap: 12 }}>
          <select value={kindFilter} onChange={e => setKindFilter(e.target.value)} style={{ padding: '10px 14px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)' }}>
            {KINDS.map(k => <option key={k} value={k}>{k === 'all' ? 'All kinds' : k}</option>)}
          </select>
        </div>
      </div>
      {filtered.length === 0 ? (
        <div className="empty-state"><div className="empty-icon">📋</div><h3>No evidence found</h3><p>No evidence entries match the current filter.</p></div>
      ) : (
        <div className="table-wrap"><table className="data"><thead><tr><th>ID</th><th>Kind</th><th>Summary</th><th>Artifacts</th><th>Recorded</th><th></th></tr></thead>
          <tbody>{filtered.map((e: any) => (
            <tr key={e.id}><td className="id-mono">{e.id}</td><td><span className="badge badge-blue">{e.kind}</span></td><td style={{ fontWeight: 500 }}>{e.summary}</td>
              <td className="id-mono">{(e.artifactIds || []).join(', ') || '—'}</td><td className="text-sm muted">{fmtDateTime(e.createdAt)}</td>
              <td><a href={`#/evidence/${e.id}`} className="btn btn-sm btn-ghost">View</a></td></tr>
          ))}</tbody></table></div>
      )}
    </Shell>
  )
}

export function EvidenceDetail({ id }: { id: string }) {
  const [loading, setLoading] = useState(true)
  const [evidence, setEvidence] = useState<any>(null)

  useEffect(() => {
    evidenceApi.list().then((res: any) => {
      const e = (res.entries || []).find((x: any) => x.id === id)
      setEvidence(e || null)
      setLoading(false)
    }).catch(() => { setEvidence(null); setLoading(false) })
  }, [id])

  const [linkedArtifacts, setLinkedArtifacts] = useState<any[]>([])
  useEffect(() => {
    if (!evidence) return
    Promise.all((evidence.artifactIds || []).map((aid: string) =>
      artifactsApi.get(aid).then((res: any) => res).catch(() => null)))
      .then((res) => setLinkedArtifacts(res.filter(Boolean)))
  }, [evidence?.id])

  if (loading || !evidence) return <Shell breadcrumb={[{ label: 'Evidence', route: '#/evidence' }, { label: 'Loading…' }]}><div className="loading-screen"><div className="spinner" /></div></Shell>

  const producer = evidence.producer || {}

  return (
    <Shell breadcrumb={[{ label: 'Evidence', route: '#/evidence' }, { label: evidence.summary }]}>
      <a href="#/evidence" className="back-link" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 16 }}><I name="arrowLeft" size={14} /> Back to evidence</a>
      <div className="page-head">
        <div>
          <div className="row" style={{ gap: 8, marginBottom: 4 }}><span className="badge badge-blue">{evidence.kind}</span></div>
          <h1>{evidence.summary}</h1>
          <p className="subtitle id-mono">{evidence.id}</p>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <h4 className="mb-12">Details</h4>
          <div style={{ display: 'grid', gap: 8 }}>
            <div className="row-between text-sm"><span className="muted">Kind</span><span className="badge badge-blue">{evidence.kind}</span></div>
            <div className="row-between text-sm"><span className="muted">Recorded</span>{fmtDateTime(evidence.createdAt)}</div>
            <div className="row-between text-sm"><span className="muted">Producer</span><span className="id-mono">{producer.id || '—'} ({producer.kind || '—'})</span></div>
            {evidence.payloadRef && <div className="row-between text-sm"><span className="muted">Payload</span><span className="id-mono">{evidence.payloadRef}</span></div>}
          </div>
        </div>

        <div className="card">
          <h4 className="mb-12">Linked artifacts</h4>
          {linkedArtifacts.length === 0 ? (
            <p className="text-sm muted">This evidence record is not linked to any artifact.</p>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {linkedArtifacts.map((a: any) => (
                <div key={a.id} className="row-between text-sm" style={{ padding: '8px 10px', borderRadius: 8, background: 'var(--surface-2)' }}>
                  <div><a href={`#/artifacts/${a.id}`} className="id-mono">{a.id}</a> <a href={`#/artifacts/${a.id}`}>{a.title}</a></div>
                  <span className="badge badge-gray">{a.type}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="card mt-16">
        <h4 className="mb-12">Trust model</h4>
        <p className="text-sm muted">This evidence record was produced by {producer.kind || 'the engine'} ({producer.id || 'unknown'}) and appended to the evidence log write-once. It contributes what it records — no more. Verifiers decide independently whether it satisfies a dimension.</p>
      </div>
    </Shell>
  )
}