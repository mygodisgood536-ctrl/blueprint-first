import React, { useState, useEffect } from 'react'
import { Shell } from '../shell'
import { stagesApi } from '../api'
import { Status } from '../ui'

/* Traceability (§26) — the Requirements Traceability Engine surface.
   Each requirement root (FEATURE/PAGE with no phase suffixes) is traced
   through DESIGN -> IMPL. Every row reports existence, per-phase evidence
   counts, missing links, and unsupported (DERIVED_FROM) edges — all real
   data returned by /api/traceability. */

interface TraceRowUI {
  requirementId: string
  requirementStatus: string
  designId: string
  designExists: boolean
  designStatus?: string
  implementationId: string
  implementationExists: boolean
  implementationStatus?: string
  missingLinks: string[]
  unsupportedEdges: string[]
  designEvidenceCount: number
  implementationEvidenceCount: number
}

export function Traceability() {
  const [loading, setLoading] = useState(true)
  const [trace, setTrace] = useState<any>(null)
  const [selected, setSelected] = useState<string>('')

  useEffect(() => {
    stagesApi.traceability().then((res: any) => {
      setTrace(res)
      setSelected((res?.rows || [])[0]?.requirementId || '')
      setLoading(false)
    }).catch(() => { setTrace(null); setLoading(false) })
  }, [])

  if (loading) return <Shell breadcrumb={[{ label: 'Traceability' }]}><div className="loading-screen"><div className="spinner" /></div></Shell>

  if (!trace || !Array.isArray(trace.rows) || trace.rows.length === 0) return (
    <Shell breadcrumb={[{ label: 'Traceability' }]}>
      <div className="page-head"><div><h1>Traceability</h1>
        <p className="subtitle">Requirements traced through DESIGN → IMPL, with evidence counts, missing links, and unsupported edges.</p></div></div>
      <div className="empty-state"><div className="empty-icon">&#128376;</div><h3>No traceability data</h3><p>No requirement rows recorded yet by the engine.</p></div>
    </Shell>
  )

  const rows: TraceRowUI[] = trace.rows
  const row = rows.find((r) => r.requirementId === selected) || rows[0]
  const complete = trace.complete === true
  const missingLinkCount = (trace.missingLinkIds || []).length
  const orphanCount = (trace.orphanedArtifacts || []).length
  const unsupportedCount = trace.unsupportedTransitions ?? 0

  return (
    <Shell breadcrumb={[{ label: 'Traceability' }]}>
      <div className="page-head"><div><h1>Traceability</h1>
        <p className="subtitle">Requirements traced through DESIGN → IMPL — a mechanically detectable condition on the artifact-ID graph.</p></div>
        {complete ? <span className="badge badge-green">Complete</span> : <span className="badge badge-yellow">{missingLinkCount} missing · {unsupportedCount} unsupported</span>}
      </div>

      <div className="grid grid-4 mb-16">
        <div className="stat-card"><div className="stat-label">Requirements</div><div className="stat-value">{trace.totalRequirements ?? rows.length}</div><div className="stat-sub">Lineage roots</div></div>
        <div className="stat-card"><div className="stat-label">Fully traced</div><div className="stat-value">{trace.fullyTraced ?? 0}</div><div className="stat-sub">Evidence-backed both phases</div></div>
        <div className="stat-card"><div className="stat-label">Missing links</div><div className="stat-value">{missingLinkCount}</div><div className="stat-sub">Design/implementation absent</div></div>
        <div className="stat-card"><div className="stat-label">Orphans</div><div className="stat-value">{orphanCount}</div><div className="stat-sub">Phased artifact, no requirement root</div></div>
      </div>

      <div className="card mb-16">
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Trace a requirement</label>
          <select value={row.requirementId} onChange={e => setSelected(e.target.value)}>
            {rows.map((r) => <option key={r.requirementId} value={r.requirementId}>{r.requirementId}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-2 mb-16">
        <div className="card">
          <h4 className="mb-12">DESIGN phase</h4>
          {row.designExists ? (
            <div style={{ display: 'grid', gap: 8 }}>
              <div className="row-between text-sm"><span className="muted">Artifact</span><a href={`#/artifacts/${row.designId}`} className="id-mono">{row.designId}</a></div>
              <div className="row-between text-sm"><span className="muted">Status</span><Status status={row.designStatus || 'IDLE'} /></div>
              <div className="row-between text-sm"><span className="muted">Evidence</span>{row.designEvidenceCount} record(s)</div>
            </div>
          ) : (
            <p className="text-sm muted">Missing — <span className="id-mono">{row.designId}</span> does not exist. <a href="#/traceability" className="text-xs">Requirements traceability requires the full chain.</a></p>
          )}
        </div>

        <div className="card">
          <h4 className="mb-12">IMPL phase</h4>
          {row.implementationExists ? (
            <div style={{ display: 'grid', gap: 8 }}>
              <div className="row-between text-sm"><span className="muted">Artifact</span><a href={`#/artifacts/${row.implementationId}`} className="id-mono">{row.implementationId}</a></div>
              <div className="row-between text-sm"><span className="muted">Status</span><Status status={row.implementationStatus || 'IDLE'} /></div>
              <div className="row-between text-sm"><span className="muted">Evidence</span>{row.implementationEvidenceCount} record(s)</div>
            </div>
          ) : (
            <p className="text-sm muted">Missing — <span className="id-mono">{row.implementationId}</span> does not exist.</p>
          )}
        </div>
      </div>

      <div className="card mb-16">
        <h4 className="mb-8">Blockers for this requirement</h4>
        {row.missingLinks.length === 0 && row.unsupportedEdges.length === 0 ? (
          <p className="text-sm muted">No missing links and no unsupported edges for this requirement.</p>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {row.missingLinks.map((id) => <div key={id} className="text-sm"><span className="badge badge-red">missing</span> <span className="id-mono">{id}</span></div>)}
            {row.unsupportedEdges.map((id) => <div key={id} className="text-sm"><span className="badge badge-yellow">unsupported edge</span> <span className="id-mono">{id}</span> — exists without its DERIVED_FROM predecessor edge</div>)}
          </div>
        )}
      </div>

      <div className="card">
        <h4 className="mb-8">Traceability matrix</h4>
        <p className="text-xs muted mb-8">A requirement counts as fully traced only when both phases exist, both carry evidence, and no links are missing or unsupported.</p>
        <div className="table-wrap"><table className="data">
          <thead><tr><th>Requirement</th><th>Status</th><th>Design</th><th>Design evidence</th><th>Implementation</th><th>Impl evidence</th><th>Missing</th><th>Unsupported</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.requirementId} style={{ cursor: 'pointer', background: r.requirementId === row.requirementId ? 'var(--surface-2)' : undefined }}
                onClick={() => setSelected(r.requirementId)}>
                <td><a href={`#/artifacts/${r.requirementId}`} onClick={e => e.stopPropagation()} className="id-mono">{r.requirementId}</a></td>
                <td className="text-sm"><Status status={r.requirementStatus} /></td>
                <td className="text-sm">{r.designExists ? <a href={`#/artifacts/${r.designId}`} className="id-mono text-xs">{r.designId}</a> : <span className="text-xs muted">absent</span>}</td>
                <td className="text-sm">{r.designEvidenceCount}</td>
                <td className="text-sm">{r.implementationExists ? <a href={`#/artifacts/${r.implementationId}`} className="id-mono text-xs">{r.implementationId}</a> : <span className="text-xs muted">absent</span>}</td>
                <td className="text-sm">{r.implementationEvidenceCount}</td>
                <td className="text-sm">{r.missingLinks.length}</td>
                <td className="text-sm">{r.unsupportedEdges.length}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
    </Shell>
  )
}