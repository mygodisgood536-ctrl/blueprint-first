import React, { useState, useEffect } from 'react'
import { Shell } from '../shell'
import { stagesApi } from '../api'

/* §1.4 Interactive Digital Twin — a simulation of the designed product where
   every element is clickable back to its DESIGN artifact and, from there, to
   the Discovery artifact and evidence that produced it (§T.1). Nothing here is
   invented: rows are a projection of the twin engine state served by
   /api/twin. */

interface TwinData {
  projectId: string | null
  blueprintId: string | null
  twinArtifactId: string | null
  pages: Array<{
    pageId: string
    pageKey: string
    title: string
    designId: string | null
    designBound: boolean
    elements: Array<{
      id: string
      kind: string
      label: string
      surface: string
      discoveryArtifactId: string
      designArtifactId: string | null
      designBound: boolean
      evidenceIds: string[]
      trace: Array<{ artifactId: string; kind: string; label: string }>
    }>
    edges: Array<{ from: string; to: string; relation: string }>
    gaps: Array<{ severity: string; message: string; pageId: string; artifactId?: string }>
  }>
  elementCount: number
  boundElementCount: number
  gapCount: number
  evidenceCount: number
  built: boolean
  note: string | null
}

export function Twin() {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<TwinData | null>(null)
  const [selected, setSelected] = useState<string>('')

  useEffect(() => {
    stagesApi.twin().then((res: any) => {
      setData(res)
      setSelected((res?.pages || [])[0]?.pageKey || '')
      setLoading(false)
    }).catch(() => { setData(null); setLoading(false) })
  }, [])

  if (loading) return <Shell breadcrumb={[{ label: 'Digital Twin' }]}><div className="loading-screen"><div className="spinner" /></div></Shell>

  if (!data || !data.built || data.pages.length === 0) return (
    <Shell breadcrumb={[{ label: 'Digital Twin' }]}>
      <div className="page-head"><div><h1>Digital Twin</h1>
        <p className="subtitle">An interactive simulation of the designed product — every element clickable back to its DESIGN artifact, its Discovery artifact, and the evidence that produced it (§1.4).</p></div></div>
      <div className="empty-state"><div className="empty-icon">&#128481;</div><h3>Twin not built</h3><p>The twin materializes after the Design Department certifies coverage against the certified Discovery baseline. Complete the design stage to build it.</p></div>
    </Shell>
  )

  const page = data.pages.find((p) => p.pageKey === selected) || data.pages[0]
  const traceOrder: Record<string, number> = { discovery: 1, design: 2, evidence: 3 }

  return (
    <Shell breadcrumb={[{ label: 'Digital Twin' }]}>
      <div className="page-head">
        <div><h1>Digital Twin</h1>
          <p className="subtitle">Every element is clickable to its DESIGN artifact, then to the Discovery artifact and evidence that produced it.</p></div>
        <a href="#/traceability" className="btn btn-ghost btn-sm">Cross-lifecycle traceability</a>
      </div>

      <div className="grid grid-4 mb-16">
        <div className="stat-card"><div className="stat-label">Pages</div><div className="stat-value">{data.pages.length}</div><div className="stat-sub">Simulated surfaces</div></div>
        <div className="stat-card"><div className="stat-label">Elements</div><div className="stat-value">{data.elementCount}</div><div className="stat-sub">Sections, actions, states</div></div>
        <div className="stat-card"><div className="stat-label">Design-bound</div><div className="stat-value">{data.boundElementCount}</div><div className="stat-sub">Realized by the design doc</div></div>
        <div className="stat-card"><div className="stat-label">Evidence records</div><div className="stat-value">{data.evidenceCount}</div><div className="stat-sub">Underpinning the twin</div></div>
      </div>

      <div className="card mb-16">
        <div className="row-between" style={{ gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
          <div className="row" style={{ gap: 10 }}>
            <span className="badge badge-green">{data.boundElementCount}/{data.elementCount} elements realized</span>
            <span className={data.gapCount === 0 ? 'badge badge-green' : 'badge badge-yellow'}>{data.gapCount} gap(s)</span>
          </div>
          <div className="text-sm muted id-mono">{data.twinArtifactId}</div>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Twin page</label>
          <select value={page.pageKey} onChange={e => setSelected(e.target.value)}>
            {data.pages.map((p) => <option key={p.pageKey} value={p.pageKey}>{p.pageKey} — {p.title}</option>)}
          </select>
        </div>
      </div>

      <div className="card mb-16">
        <div className="row-between mb-12" style={{ gap: 12, flexWrap: 'wrap' }}>
          <h4 style={{ margin: 0 }}>Page design binding</h4>
          {page.designId ? (
            <div className="row" style={{ gap: 8 }}>
              <span className="id-mono text-xs"><a href={`#/artifacts/${page.designId}`}>{page.designId}</a></span>
              {page.designBound ? <span className="badge badge-green">Design-bound</span> : <span className="badge badge-yellow">Unbound</span>}
            </div>
          ) : <span className="badge badge-red">No design package — unrealizable twin surface</span>}
        </div>
        <div className="table-wrap"><table className="data">
          <thead><tr><th>Surface</th><th>Element</th><th>Kind</th><th>Discovery</th><th>Design</th><th>Evidence</th><th>Trace</th></tr></thead>
          <tbody>
            {page.elements.map((e) => {
              const trace = [...e.trace].sort((a, b) => (traceOrder[a.kind] ?? 0) - (traceOrder[b.kind] ?? 0))
              const stepCls: Record<string, string> = { discovery: 'badge-gray', design: 'badge-blue', evidence: 'badge-green' }
              return (
                <tr key={e.id}>
                  <td className="text-sm muted">{e.surface}</td>
                  <td className="text-sm">{e.label}</td>
                  <td><span className="badge badge-gray">{e.kind}</span></td>
                  <td><a href={`#/artifacts/${e.discoveryArtifactId}`} className="id-mono text-xs">{e.discoveryArtifactId}</a></td>
                  <td>{e.designArtifactId ? <a href={`#/artifacts/${e.designArtifactId}`} className="id-mono text-xs">{e.designArtifactId}</a> : <span className="text-xs muted" style={{ color: e.designBound ? undefined : 'var(--red-600)' }}>unbound</span>}</td>
                  <td className="text-sm">{e.evidenceIds.length}</td>
                  <td>
                    <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                      {trace.map((t) => <a key={`${t.kind}:${t.artifactId}`} href={`#/artifacts/${t.artifactId}`} className={`badge ${stepCls[t.kind] || 'badge-gray'}`}>{t.kind}</a>)}
                    </div>
                  </td>
                </tr>
              )
            })}
            {page.elements.length === 0 && <tr><td colSpan={7} className="text-sm muted">No elements on this page surface.</td></tr>}
          </tbody>
        </table></div>
      </div>

      {page.gaps.length > 0 && (
        <div className="card mb-16">
          <h4 className="mb-8">Twin gaps — {page.pageKey}</h4>
          <div style={{ display: 'grid', gap: 8 }}>
            {page.gaps.map((g, i) => (
              <div key={i} className="text-sm">
                <span className={g.severity === 'error' ? 'badge badge-red' : 'badge badge-yellow'}>{g.severity}</span> {g.message}
                {g.artifactId && <span className="id-mono text-xs muted" style={{ marginLeft: 8 }}>{g.artifactId}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <h4 className="mb-8">Trace chain</h4>
        <p className="text-sm muted">Each element carries an unbroken Discovery → DESIGN → evidence lineage (§T.1). Click any badge to open the underlying artifact.</p>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <span className="badge badge-gray">Discovery artifact</span>
          <span className="badge badge-blue">DESIGN artifact</span>
          <span className="badge badge-green">Evidence record</span>
        </div>
      </div>
    </Shell>
  )
}