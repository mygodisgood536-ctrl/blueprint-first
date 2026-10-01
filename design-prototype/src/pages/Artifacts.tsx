import React, { useState, useEffect } from 'react'
import { Shell } from '../shell'
import { artifactsApi, dependencyMapApi, evidenceApi, lineageApi, stagesApi } from '../api'
import { fmtDateTime, Status } from '../ui'
import { I } from '../icons2'

/* Artifacts (§25) — the global artifact catalogue.
   List: filterable by type, searchable by id/title, sortable by id, type,
   or version. Detail: identity, provenance, relationships, evidence,
   traceability. Everything rendered here comes from real backend payloads;
   fields the backend does not expose are never fabricated. */

const PHASES = ['DESIGN', 'IMPL', 'TEST', 'DEPLOY', 'OPS', 'PERM']
const SORTS = [
  { key: 'id', label: 'ID' },
  { key: 'type', label: 'Type' },
  { key: 'version', label: 'Version' },
] as const

function phaseOf(id: string): string | null {
  const last = id.slice(id.lastIndexOf('-') + 1).toUpperCase()
  return PHASES.includes(last) ? last : null
}

function baseOf(id: string): string {
  const last = id.slice(id.lastIndexOf('-') + 1).toUpperCase()
  return PHASES.includes(last) ? id.slice(0, id.lastIndexOf('-')) : id
}

export function ArtifactsList() {
  const [loading, setLoading] = useState(true)
  const [artifacts, setArtifacts] = useState<any[]>([])
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [phaseFilter, setPhaseFilter] = useState('all')
  const [sortKey, setSortKey] = useState<'id' | 'type' | 'version'>('id')

  useEffect(() => {
    artifactsApi.list().then((res: any) => {
      setArtifacts(res.artifacts)
      setLoading(false)
    }).catch(() => { setArtifacts([]); setLoading(false) })
  }, [])

  const filtered = artifacts.filter((a: any) => {
    if (typeFilter !== 'all' && a.type !== typeFilter) return false
    if (phaseFilter !== 'all' && phaseOf(a.id) !== phaseFilter) return false
    if (search && !a.title.toLowerCase().includes(search.toLowerCase()) && !a.id.toLowerCase().startsWith(search.toLowerCase())) return false
    return true
  }).sort((x: any, y: any) => {
    if (sortKey === 'id') return String(x.id).localeCompare(String(y.id))
    if (sortKey === 'type') return String(x.type).localeCompare(String(y.type)) || String(x.id).localeCompare(String(y.id))
    return Number(y.version ?? 0) - Number(x.version ?? 0) || String(x.id).localeCompare(String(y.id))
  })

  const types = ['all', ...new Set(artifacts.map((a: any) => a.type))]

  if (loading) return <Shell breadcrumb={[{ label: 'Artifacts' }]}><div className="loading-screen"><div className="spinner" /></div></Shell>
  return (
    <Shell breadcrumb={[{ label: 'Artifacts' }]}>
      <div className="page-head"><div><h1>Artifacts</h1><p className="subtitle">{artifacts.length} artifacts across your projects.</p></div></div>
      <div className="card mb-16"><div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
        <div className="grow" style={{ minWidth: 220 }}><input placeholder="Search by title or ID prefix…" value={search} onChange={e => setSearch(e.target.value)} style={{ width: '100%', padding: '10px 14px', border: '1px solid var(--border)', borderRadius: 10, outline: 'none' }} /></div>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} style={{ padding: '10px 14px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)' }}>{types.map(t => <option key={t} value={t}>{t === 'all' ? 'All types' : t}</option>)}</select>
        <select value={phaseFilter} onChange={e => setPhaseFilter(e.target.value)} style={{ padding: '10px 14px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)' }}><option value="all">All phases</option>{PHASES.map(t => <option key={t} value={t}>{t}</option>)}</select>
        <select value={sortKey} onChange={e => setSortKey(e.target.value as 'id' | 'type' | 'version')} style={{ padding: '10px 14px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)' }} aria-label="Sort artifacts">{SORTS.map(s => <option key={s.key} value={s.key}>Sort: {s.label}</option>)}</select>
      </div></div>
      {filtered.length === 0 ? (
        <div className="empty-state"><div className="empty-icon">&#128230;</div><h3>No artifacts found</h3><p>No artifacts match the current search or filters. Clear them to see everything again.</p></div>
      ) : (
        <div className="table-wrap"><table className="data"><thead><tr><th>ID</th><th>Type</th><th>Title</th><th>Status</th><th>Version</th><th>Phase</th></tr></thead>
          <tbody>{filtered.map((a: any) => {
            const ph = phaseOf(a.id)
            return (
            <tr key={a.id}><td><a href={`#/artifacts/${a.id}`} className="id-mono">{a.id}</a></td><td><span className="badge badge-gray">{a.type}</span></td><td style={{ fontWeight: 600 }}>{a.title}</td>
              <td><Status status={a.status} /></td><td>v{a.version}</td><td>{ph ? <span className="badge badge-blue">{ph}</span> : <span className="text-xs muted">—</span>}</td></tr>
            )
          })}</tbody></table></div>
      )}
    </Shell>
  )
}

export function ArtifactDetail({ id }: { id: string }) {
  const [loading, setLoading] = useState(true)
  const [artifact, setArtifact] = useState<any>(null)

  /* Real evidence linked to this artifact. */
  const [linkedEvidence, setLinkedEvidence] = useState<any[]>([])
  /* Real lineage for the artifact's base (first-page chain from backend). */
  const [lineageData, setLineageData] = useState<any>(null)
  /* Real dependency map edges for this artifact. */
  const [depEdges, setDepEdges] = useState<any[]>([])
  /* Real traceability row for this artifact (as a requirement root). */
  const [traceRow, setTraceRow] = useState<any>(null)

  useEffect(() => {
    artifactsApi.get(id).then((res: any) => {
      setArtifact(res)
      setLoading(false)
    }).catch(() => { setArtifact(null); setLoading(false) })
  }, [id])

  useEffect(() => {
    if (!artifact) return
    evidenceApi.list().then((res: any) => {
      setLinkedEvidence((res.entries || []).filter((e: any) => (e.artifactIds || []).includes(artifact.id)))
    })
  }, [artifact?.id])

  useEffect(() => {
    if (!artifact) return
    lineageApi.get().then((res: any) => setLineageData(res)).catch(() => setLineageData(null))
  }, [artifact?.id])

  useEffect(() => {
    if (!artifact) return
    dependencyMapApi.get().then((res: any) => {
      setDepEdges((res.edges || []).filter((e: any) => e.from === artifact.id || e.to === artifact.id))
    }).catch(() => setDepEdges([]))
  }, [artifact?.id])

  useEffect(() => {
    if (!artifact) return
    stagesApi.traceability().then((res: any) => {
      const rows = res?.rows || []
      const base = baseOf(artifact.id)
      const row = rows.find((r: any) => r.requirementId === artifact.id || r.requirementId === base)
      setTraceRow(row || null)
    }).catch(() => setTraceRow(null))
  }, [artifact?.id])

  if (loading || !artifact) return <Shell breadcrumb={[{ label: 'Artifacts', route: '#/artifacts' }, { label: 'Loading…' }]}><div className="loading-screen"><div className="spinner" /></div></Shell>

  const ph = phaseOf(artifact.id)
  const chainLink = (lineageData?.links || []).find((l: any) => l.id === artifact.id)

  return (
    <Shell breadcrumb={[{ label: 'Artifacts', route: '#/artifacts' }, { label: artifact.title }]}>
      <a href="#/artifacts" className="back-link" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 16 }}><I name="arrowLeft" size={14} /> Back to artifacts</a>
      <div className="page-head"><div><div className="row" style={{ gap: 8, marginBottom: 4 }}><span className="badge badge-gray">{artifact.type}</span><Status status={artifact.status} />{ph && <span className="badge badge-blue">{ph}</span>}</div>
        <h1>{artifact.title}</h1><p className="subtitle id-mono">{artifact.id}</p></div></div>

      {/* Production lineage — from real backend lineage data. */}
      <div className="card mb-16">
        <div className="row-between mb-8"><h4>Production lineage</h4>
          <a href="#/lineage" className="text-sm">Full lineage view →</a></div>
        {lineageData && lineageData.links?.length ? (
          <>
            <div className="phase-strip">
              {lineageData.links.map((l: any, i: number) => (
                <React.Fragment key={l.id}>
                  <div className={`phase-node ${l.exists ? 'recorded' : 'pending'}`} title={l.id}>
                    <div className="phase-dot" />
                    <div className="phase-label">{phaseOf(l.id) || 'BASE'}</div>
                    <div className="phase-sub">{l.exists ? (l.status || 'recorded') : 'pending'}</div>
                  </div>
                  {i < lineageData.links.length - 1 && <div className={`phase-arrow ${l.exists ? 'done' : ''}`}>&#8594;</div>}
                </React.Fragment>
              ))}
            </div>
            <p className="text-xs muted mt-8">Canonical chain for <span className="id-mono">{lineageData.firstPageId}</span> — the backend's first-page lineage. {chainLink ? 'Your artifact sits in this chain.' : 'Your artifact is in a different chain; only the first-page chain is exposed.'}</p>
          </>
        ) : (
          <p className="text-sm muted">Production lineage not yet recorded.</p>
        )}
      </div>

      <div className="grid grid-2">
        <div className="card"><h4 className="mb-12">Identity</h4>
          <div style={{ display: 'grid', gap: 8 }}>
            <div className="row-between text-sm"><span className="muted">ID</span><span className="id-mono">{artifact.id}</span></div>
            <div className="row-between text-sm"><span className="muted">Type</span><span className="badge badge-gray">{artifact.type}</span></div>
            <div className="row-between text-sm"><span className="muted">Version</span>v{artifact.version}</div>
            <div className="row-between text-sm"><span className="muted">Phase</span>{ph ? <span className="badge badge-blue">{ph}</span> : <span className="text-sm muted">—</span>}</div>
            <div className="row-between text-sm"><span className="muted">Status</span><Status status={artifact.status} /></div>
            <div className="row-between text-sm"><span className="muted">Project</span><a href={`#/projects/${artifact.projectId}`} className="id-mono">{artifact.projectId}</a></div>
            {artifact.confidence !== null && artifact.confidence !== undefined && (
              <div className="row-between text-sm"><span className="muted">Confidence</span>{(artifact.confidence * 100).toFixed(0)}%</div>
            )}
          </div></div>

        <div className="card"><h4 className="mb-12">Provenance</h4>
          <div style={{ display: 'grid', gap: 8 }}>
            <div className="row-between text-sm"><span className="muted">Produced by</span>the NEXORA engine</div>
            <div className="row-between text-sm"><span className="muted">Evidence</span>{linkedEvidence.length > 0 ? (
              <span>{linkedEvidence.map((e: any, i: number) => (
                <span key={e.id}>{i > 0 ? ', ' : ''}<a href={'#/evidence/' + e.id} className="id-mono">{e.id}</a></span>
              ))}</span>
            ) : <span className="muted">none</span>}</div>
          </div></div>
      </div>

      <div className="grid grid-2 mt-16">
        <div className="card"><h4 className="mb-12">Relationships</h4>
          <div style={{ display: 'grid', gap: 8 }}>
            <div className="text-sm"><span className="muted">Depends on:</span>{depEdges.filter((e: any) => e.from === artifact.id).length ? (
              depEdges.filter((e: any) => e.from === artifact.id).map((e: any, i: number) => <span key={i}>{i > 0 && ', '}<a href={`#/artifacts/${e.to}`} className="id-mono">{e.to}</a> <span className="text-xs muted">({e.relation})</span></span>)
            ) : (
              <span className="muted"> —</span>
            )}</div>
            <div className="text-sm"><span className="muted">Depended on by:</span>{depEdges.filter((e: any) => e.to === artifact.id).length ? (
              depEdges.filter((e: any) => e.to === artifact.id).map((e: any, i: number) => <span key={i}>{i > 0 && ', '}<a href={`#/artifacts/${e.from}`} className="id-mono">{e.from}</a> <span className="text-xs muted">({e.relation})</span></span>)
            ) : (
              <span className="muted"> —</span>
            )}</div>
            <div className="text-sm"><a href="#/dependency-map">Open dependency map →</a></div>
          </div></div>

        <div className="card"><h4 className="mb-12">Traceability</h4>
          {traceRow ? (
            <div style={{ display: 'grid', gap: 8 }}>
              <div className="text-sm"><span className="muted">Requirement row:</span> <span className="id-mono">{traceRow.requirementId}</span></div>
              <div className="text-sm"><span className="muted">Design: </span>{traceRow.designExists ? <a href={`#/artifacts/${traceRow.designId}`} className="id-mono text-xs">{traceRow.designId}</a> : <span className="muted">absent</span>} · {traceRow.designEvidenceCount} evidence</div>
              <div className="text-sm"><span className="muted">Implementation: </span>{traceRow.implementationExists ? <a href={`#/artifacts/${traceRow.implementationId}`} className="id-mono text-xs">{traceRow.implementationId}</a> : <span className="muted">absent</span>} · {traceRow.implementationEvidenceCount} evidence</div>
              <div className="text-sm"><span className="muted">Missing links:</span> {traceRow.missingLinks.length}</div>
              <div className="text-sm"><span className="muted">Unsupported edges:</span> {traceRow.unsupportedEdges.length}</div>
              <div className="text-sm"><a href="#/traceability">Open traceability view →</a></div>
            </div>
          ) : (
            <p className="text-sm muted">No traceability row for this artifact. <a href="#/traceability">Open traceability view →</a></p>
          )}
        </div>
      </div>

      <div className="card mt-16">
        <h4 className="mb-8">Evidence supporting this artifact</h4>
        {linkedEvidence.length === 0 ? (
          <p className="text-sm muted">No evidence linked yet. Evidence answers "why does NEXORA believe this?" — see <a href="#/evidence">Evidence</a>.</p>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {linkedEvidence.map((e: any) => (
              <div key={e.id} className="row-between text-sm" style={{ padding: '10px 14px', borderRadius: 8, background: 'var(--surface-2)' }}>
                <span>{e.summary}</span>
                <span className="row" style={{ gap: 8 }}><span className="badge badge-blue">{e.kind}</span><span className="id-mono text-xs muted">{e.id}</span><a href={`#/evidence/${e.id}`} className="btn btn-sm btn-ghost">View</a></span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Shell>
  )
}