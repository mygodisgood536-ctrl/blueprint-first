import React, { useState, useEffect } from 'react'
import { Shell } from '../shell'
import { stagesApi } from '../api'

/* §0.6 Recursive Page Expansion — every page is determined through all 14
   layers (Purpose/Structure -> Recovery) before it is eligible for Design.
   A layer resolves to covered / added / not-relevant / blocked; a blocked
   layer records an omission that must be routed rather than invented. All
   counts and statuses are projections of the real engine state served by
   /api/expansion. */

interface ExpansionData {
  status: string
  pages: Array<{
    pageId: string
    pageKey: string
    title: string
    allLayersDetermined: boolean
    omissions: string[]
    layers: Array<{ layer: number; name: string; status: string; note: string; artifactIds: string[] }>
  }>
  tally: { covered: number; added: number; 'not-relevant': number; blocked: number } | null
  artifactIds: string[]
  fullDepartment: {
    contentAdded: number
    edgeStatesAdded: number
    risks: number
    audited: boolean
    artifactIds: string[]
  } | null
}

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  covered: { text: 'Covered', cls: 'badge-green' },
  added: { text: 'Added', cls: 'badge-blue' },
  'not-relevant': { text: 'Not relevant', cls: 'badge-gray' },
  blocked: { text: 'Blocked', cls: 'badge-red' },
}

export function Expansion() {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<ExpansionData | null>(null)
  const [selected, setSelected] = useState<string>('')

  useEffect(() => {
    stagesApi.expansion().then((res: any) => {
      setData(res)
      setSelected((res?.pages || [])[0]?.pageKey || '')
      setLoading(false)
    }).catch(() => { setData(null); setLoading(false) })
  }, [])

  if (loading) return <Shell breadcrumb={[{ label: 'Expansion' }]}><div className="loading-screen"><div className="spinner" /></div></Shell>

  if (!data || data.status !== 'READY' || data.pages.length === 0) return (
    <Shell breadcrumb={[{ label: 'Expansion' }]}>
      <div className="page-head"><div><h1>Recursive Page Expansion</h1>
        <p className="subtitle">Every page through all fourteen layers (§0.6) — machine-checked, evidence-backed, and gated before Design.</p></div></div>
      <div className="empty-state"><div className="empty-icon">&#128202;</div><h3>Expansion pending</h3><p>Recursive Page Expansion runs with the Level-3 Discovery Department. Run the full discovery pipeline to build the 14-layer determination.</p></div>
    </Shell>
  )

  const tally = data.tally || { covered: 0, added: 0, 'not-relevant': 0, blocked: 0 }
  const page = data.pages.find((p) => p.pageKey === selected) || data.pages[0]
  const full = data.fullDepartment

  return (
    <Shell breadcrumb={[{ label: 'Expansion' }]}>
      <div className="page-head">
        <div><h1>Recursive Page Expansion</h1>
          <p className="subtitle">Every page is expanded through all 14 layers; blocked layers record an omission instead of an invented requirement.</p></div>
        <span className="badge badge-green">Pass 10 determined</span>
      </div>

      <div className="grid grid-4 mb-16">
        <div className="stat-card"><div className="stat-label">Pages</div><div className="stat-value">{data.pages.length}</div><div className="stat-sub">× 14 layers each</div></div>
        <div className="stat-card"><div className="stat-label">Layers added</div><div className="stat-value">{tally.added}</div><div className="stat-sub">New artifacts materialized</div></div>
        <div className="stat-card"><div className="stat-label">Layers covered</div><div className="stat-value">{tally.covered}</div><div className="stat-sub">Already evidenced</div></div>
        <div className="stat-card"><div className="stat-label">Blocked</div><div className="stat-value">{tally.blocked}</div><div className="stat-sub">Omissions routed, not invented</div></div>
      </div>

      <div className="card mb-16">
        <div className="row-between" style={{ gap: 12, flexWrap: 'wrap' }}>
          <div className="row" style={{ gap: 10 }}>
            <div className="stat-label">Layer resolution</div>{' '}
            <span className="badge badge-green">{tally.covered} covered</span>
            <span className="badge badge-blue">{tally.added} added</span>
            <span className="badge badge-gray">{tally['not-relevant']} not relevant</span>
            <span className="badge badge-red">{tally.blocked} blocked</span>
          </div>
          <div className="text-sm muted">All produced artifacts pass the Level-3 evidence + provenance gate before promotion.</div>
        </div>
      </div>

      <div className="card mb-16">
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Expanded page</label>
          <select value={page.pageKey} onChange={e => setSelected(e.target.value)}>
            {data.pages.map((p) => <option key={p.pageKey} value={p.pageKey}>{p.pageKey} — {p.title}</option>)}
          </select>
        </div>
        <div className="mt-12" style={{ display: 'grid', gap: 6 }}>
          <div className="row-between text-sm"><span className="muted">Page artifact</span><a href={`#/artifacts/${page.pageId}`} className="id-mono">{page.pageId}</a></div>
          <div className="row-between text-sm"><span className="muted">Exit condition</span>{page.allLayersDetermined ? <span className="badge badge-green">All 14 layers determined</span> : <span className="badge badge-red">Not determined</span>}</div>
        </div>
      </div>

      <div className="card mb-16">
        <h4 className="mb-8">Fourteen-layer determination — {page.pageKey}</h4>
        <div className="table-wrap"><table className="data">
          <thead><tr><th>Layer</th><th>Determines</th><th>Resolution</th><th>Note</th><th>Produced</th></tr></thead>
          <tbody>
            {page.layers.map((l) => {
              const meta = STATUS_LABEL[l.status] || STATUS_LABEL.covered
              return (
                <tr key={l.layer}>
                  <td className="text-sm mono">{l.layer}</td>
                  <td className="text-sm">{l.name}</td>
                  <td><span className={`badge ${meta.cls}`}>{meta.text}</span></td>
                  <td className="text-sm muted">{l.note}</td>
                  <td className="text-xs muted">{l.artifactIds.map((id) => <span key={id} className="id-mono text-xs">{id}</span>).reduce((acc: any, x) => acc === null ? [x] : [...acc, ' ', x], null)}</td>
                </tr>
              )
            })}
          </tbody>
        </table></div>
      </div>

      {page.omissions.length > 0 && (
        <div className="card mb-16">
          <h4 className="mb-8">Routed omissions — {page.pageKey}</h4>
          <p className="text-sm muted mb-8">These layers are relevant but depend on product knowledge the engine must not invent. Each omission is surfaced here instead of being silently resolved.</p>
          <div style={{ display: 'grid', gap: 8 }}>
            {page.omissions.map((o) => <div key={o} className="text-sm"><span className="badge badge-red">omission</span> {o}</div>)}
          </div>
        </div>
      )}

      {full && (
        <div className="card">
          <h4 className="mb-8">Level-3 promotion gate</h4>
          <p className="text-sm muted mb-8">Expansion artifacts are DRAFT when produced; only evidence-backed, provenance-carrying artifacts are promoted to VERIFIED by the department gate.</p>
          <div className="grid grid-4">
            <div className="stat-card"><div className="stat-label">Content added</div><div className="stat-value">{full.contentAdded}</div><div className="stat-sub">DW-C1 regions</div></div>
            <div className="stat-card"><div className="stat-label">Edge states added</div><div className="stat-value">{full.edgeStatesAdded}</div><div className="stat-sub">Realized via states</div></div>
            <div className="stat-card"><div className="stat-label">Risks registered</div><div className="stat-value">{full.risks}</div><div className="stat-sub">Risk &amp; Assumption Register</div></div>
            <div className="stat-card"><div className="stat-label">Independent audit</div><div className="stat-value">{full.audited ? 'Passed' : 'Pending'}</div><div className="stat-sub">Dept workforce audited</div></div>
          </div>
          <div className="mt-12 text-sm muted">Expansion artifacts: {data.artifactIds.length} · Full-department gates: {full.artifactIds.length} certified artifact(s).</div>
        </div>
      )}
    </Shell>
  )
}