import React, { useState, useEffect, useMemo } from 'react'
import { Shell } from '../shell'
import { artifactsApi, dependencyMapApi } from '../api'

/* Dependency map (§25) — a real graph visualization.
   The backend exposes edges ({from, relation, to}); nodes are derived from
   those edges plus the artifact catalogue for titles/types. Edge count is
   real (result.stats). Node evidence counts come from each artifact's own
   evidenceIds. Positions are a deterministic layout, not backend data. */

interface MapNode { id: string; title: string; type: string; evidence: number }
interface MapEdge { from: string; relation: string; to: string }

function hashNum(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h / 4294967295
}

export function DependencyMap() {
  const [loading, setLoading] = useState(true)
  const [edges, setEdges] = useState<MapEdge[]>([])
  const [nodeMap, setNodeMap] = useState<Record<string, MapNode>>({})
  const [hover, setHover] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([dependencyMapApi.get(), artifactsApi.list()])
      .then(([dep, arts]) => {
        setEdges(dep.edges || [])
        const catal: Record<string, MapNode> = {}
        for (const a of arts.artifacts) {
          catal[a.id] = { id: a.id, title: a.title, type: a.type, evidence: (a.evidenceIds || []).length }
        }
        setNodeMap(catal)
        setLoading(false)
      })
      .catch(() => { setEdges([]); setNodeMap({}); setLoading(false) })
  }, [])

  // Deterministic layout: outgoing-degree bands top to bottom, hash by id.
  const layout = useMemo(() => {
    const ids = Array.from(new Set<any>(edges.flatMap((e) => [e.from, e.to])))
    const inDeg: Record<string, number> = {}
    for (const e of edges) inDeg[e.to] = (inDeg[e.to] || 0) + 1
    const bands = new Map<number, string[]>()
    for (const id of ids) {
      const band = Math.min(inDeg[id] || 0, 3)
      if (!bands.has(band)) bands.set(band, [])
      bands.get(band)!.push(id)
    }
    const pos: Record<string, { x: number; y: number }> = {}
    const W = 860
    const H = 380
    const bandsArr = [...bands.entries()].sort((a, b) => a[0] - b[0])
    bandsArr.forEach(([, arr], bi) => {
      const count = bandsArr.length || 1
      const y = 60 + (H - 120) * (bi / Math.max(1, count - 1))
      arr.forEach((id, i) => { pos[id] = { x: 70 + (W - 140) * (i / Math.max(1, arr.length - 1)), y } })
    })
    return pos
  }, [edges])

  const nodes: MapNode[] = Array.from(new Set<any>(edges.flatMap((e) => [e.from, e.to]))).map((id) =>
    nodeMap[id] || { id, title: id, type: 'ARTIFACT', evidence: 0 })

  if (loading) return <Shell breadcrumb={[{ label: 'Dependency map' }]}><div className="loading-screen"><div className="spinner" /></div></Shell>

  const rendered = nodes.filter((n) => layout[n.id])

  return (
    <Shell breadcrumb={[{ label: 'Dependency map' }]}>
      <div className="page-head"><div><h1>Dependency map</h1>
        <p className="subtitle">How artifacts depend on each other ({edges.length} edge(s), {nodes.length} node(s)). Node size reflects evidence count. Click a node to open its artifact.</p></div></div>

      {rendered.length === 0 ? (
        <div className="empty-state"><div className="empty-icon">&#128220;</div><h3>No dependencies</h3><p>The dependency graph has no edges yet.</p></div>
      ) : (
        <>
          <div className="card mb-16">
            <svg viewBox={`0 0 860 420`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="Artifact dependency graph">
              <defs>
                <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--ink-300)" />
                </marker>
              </defs>
              {edges.map((e: MapEdge, i: number) => {
                const a = layout[e.from]
                const b = layout[e.to]
                if (!a || !b) return null
                const active = hover === e.from || hover === e.to
                return (
                  <g key={i}>
                    <line x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                      stroke={active ? 'var(--green-500)' : 'var(--ink-300)'} strokeWidth={active ? 2.5 : 1.5}
                      markerEnd="url(#arrow)" opacity={hover && !active ? 0.3 : 1} />
                    <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 6} textAnchor="middle" fontSize={10}
                      fill={active ? 'var(--green-700)' : 'var(--ink-500)'} fontFamily="var(--mono)">{e.relation}</text>
                  </g>
                )
              })}
              {rendered.map((n: MapNode) => {
                const p = layout[n.id]
                const active = hover === n.id
                const r = 12 + Math.min(n.evidence, 5) * 2
                return (
                  <g key={n.id} onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)}
                    onClick={() => { window.location.hash = `#/artifacts/${n.id}` }} style={{ cursor: 'pointer' }}>
                    <circle cx={p.x} cy={p.y} r={r} fill="var(--green-600)" opacity={hover && !active ? 0.35 : 1}
                      stroke={active ? 'var(--green-700)' : 'var(--bg)'} strokeWidth={active ? 3 : 2} />
                    <text x={p.x} y={p.y - r - 8} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--ink-900)">{n.title.length > 18 ? n.title.slice(0, 17) + '…' : n.title}</text>
                    <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize={9} fill="#fff" fontFamily="var(--mono)">{n.evidence} evidence</text>
                  </g>
                )
              })}
            </svg>
          </div>

          <div className="table-wrap"><table className="data">
            <thead><tr><th>Artifact</th><th>Type</th><th>Evidence</th><th>Depends on</th><th>Depended on by</th></tr></thead>
            <tbody>
              {rendered.map((n) => {
                const out = edges.filter((e) => e.from === n.id)
                const inn = edges.filter((e) => e.to === n.id)
                return (
                  <tr key={n.id}>
                    <td><a href={`#/artifacts/${n.id}`} className="id-mono text-sm">{n.id}</a> <span style={{ fontWeight: 600 }}>{n.title}</span></td>
                    <td><span className="badge badge-gray">{n.type}</span></td>
                    <td className="text-sm">{n.evidence}</td>
                    <td className="text-sm">{out.length ? out.map((e, i) => (
                      <span key={i}>{i > 0 && ', '}<a href={`#/artifacts/${e.to}`} className="id-mono">{nodeMap[e.to]?.title || e.to}</a> <span className="muted text-xs">({e.relation})</span></span>
                    )) : <span className="muted">—</span>}</td>
                    <td className="text-sm">{inn.length ? inn.map((e, i) => (
                      <span key={i}>{i > 0 && ', '}<a href={`#/artifacts/${e.from}`} className="id-mono">{nodeMap[e.from]?.title || e.from}</a> <span className="muted text-xs">({e.relation})</span></span>
                    )) : <span className="muted">—</span>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table></div>
        </>
      )}
    </Shell>
  )
}