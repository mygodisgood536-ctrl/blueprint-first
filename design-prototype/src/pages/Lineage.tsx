import React, { useState, useEffect } from 'react'
import { Shell } from '../shell'
import { artifactsApi, lineageApi } from '../api'

/* Lineage view (§25) — the production-lineage surface.
   The backend reports the canonical chain for the project's first page
   (BASE -> DESIGN -> IMPL -> TEST -> DEPLOY -> OPS -> PERM). Each link is
   { id, exists, status }; gaps explain why the chain is not contiguous. */

const PHASE_ORDER = ['BASE', 'DESIGN', 'IMPL', 'TEST', 'DEPLOY', 'OPS', 'PERM']

function phaseOf(id: string): string {
  const last = id.slice(id.lastIndexOf('-') + 1).toUpperCase()
  return PHASE_ORDER.includes(last) ? last : 'BASE'
}

export function Lineage() {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<any>(null)
  const [titleMap, setTitleMap] = useState<Record<string, string>>({})

  useEffect(() => {
    Promise.all([lineageApi.get(), artifactsApi.list()])
      .then(([res, arts]) => {
        setData(res)
        const map: Record<string, string> = {}
        for (const a of arts.artifacts) map[a.id] = a.title
        setTitleMap(map)
        setLoading(false)
      })
      .catch(() => { setData(null); setLoading(false) })
  }, [])

  if (loading) return <Shell breadcrumb={[{ label: 'Lineage' }]}><div className="loading-screen"><div className="spinner" /></div></Shell>

  const links = data?.links || []
  const baseId = data?.firstPageId || (links[0] ? links[0].id.slice(0, links[0].id.lastIndexOf('-')) : '')
  const gaps = data?.gaps || []
  const completeThrough = data?.completeThrough || null
  const recordedCount = links.filter((l: any) => l.exists).length

  return (
    <Shell breadcrumb={[{ label: 'Lineage' }]}>
      <div className="page-head"><div><h1>Production lineage</h1>
        <p className="subtitle">The base artifact traced through its full production chain: DESIGN → IMPL → TEST → DEPLOY → OPS → PERM.</p></div>
        <span className="badge badge-gray">{recordedCount}/{links.length} phase(s) recorded</span>
      </div>

      {links.length === 0 ? (
        <div className="empty-state"><div className="empty-icon">&#128279;</div><h3>No lineage yet</h3><p>No phase artifacts recorded for this project.</p></div>
      ) : (
        <>
          <div className="card mb-16">
            <div className="row-between mb-12">
              <div className="row" style={{ gap: 10 }}>
                <h4 style={{ margin: 0 }}>{titleMap[baseId] || baseId}</h4>
                <span className="id-mono text-sm muted">{baseId}</span>
              </div>
              {completeThrough && <span className="text-xs muted">Complete through <span className="id-mono">{completeThrough}</span></span>}
            </div>
            <div className="phase-strip">
              {links.map((l: any, i: number) => (
                <React.Fragment key={l.id}>
                  <div className={`phase-node ${l.exists ? 'recorded' : 'pending'}`} title={`${l.id} — ${l.exists ? 'recorded' : 'pending'}`}>
                    <div className="phase-dot" />
                    <div className="phase-label">{phaseOf(l.id)}</div>
                    <div className="phase-sub">{l.exists ? (l.status || 'recorded') : 'pending'}</div>
                  </div>
                  {i < links.length - 1 && <div className={`phase-arrow ${l.exists ? 'done' : ''}`}>&#8594;</div>}
                </React.Fragment>
              ))}
            </div>
          </div>

          <div className="card mb-16">
            <h4 className="mb-8">Chain detail</h4>
            <div className="table-wrap"><table className="data">
              <thead><tr><th>Phase</th><th>Artifact</th><th>Status</th><th>State</th></tr></thead>
              <tbody>
                {links.map((l: any) => (
                  <tr key={l.id}>
                    <td><span className="badge badge-blue">{phaseOf(l.id)}</span></td>
                    <td><a href={`#/artifacts/${l.id}`} className="id-mono text-sm">{l.id}</a> <span className="text-xs muted">{titleMap[l.id] || ''}</span></td>
                    <td><span className={`badge ${l.exists ? 'badge-green' : 'badge-gray'}`}>{l.exists ? 'recorded' : 'pending'}</span></td>
                    <td className="text-sm muted">{l.exists ? (l.status || '—') : 'not created'}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>

          <div className="card" style={{ borderColor: gaps.length ? 'var(--warning)' : 'var(--green-200)' }}>
            <h4 className="mb-8">Lineage gaps</h4>
            {gaps.length === 0 ? (
              <p className="text-sm muted">No gaps — the chain is contiguous.</p>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                {gaps.map((g: any, i: number) => (
                  <div key={i} className="text-sm"><span className="badge badge-yellow">{g.id}</span> {g.reason}</div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </Shell>
  )
}