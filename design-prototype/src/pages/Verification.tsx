import React, { useState, useEffect } from 'react'
import { Shell } from '../shell'
import { stagesApi } from '../api'
import { Status } from '../ui'
import { I } from '../icons2'

/* Verification — master verification dimensions from the Blueprint-First backend.
   Each dimension represents a forward‑facing quality requirement. */

export function Verification() {
  const [loading, setLoading] = useState(true)
  const [sum, setSum] = useState<any>(null)

  const refresh = () => {
    setLoading(true)
    stagesApi.verification().then((res: any) => {
      setSum(res)
      setLoading(false)
    }).catch(() => { setSum(null); setLoading(false) })
  }

  useEffect(refresh, [])

  if (loading) return <Shell breadcrumb={[{ label: 'Verification' }]}><div className="loading-screen"><div className="spinner" /></div></Shell>
  if (!sum) return <Shell breadcrumb={[{ label: 'Verification' }]}><div className="empty-state"><h3>Verification unavailable</h3><p>The verification stage has not produced a report.</p></div></Shell>

  const dims = [
    { id: 'master', label: 'Master verification', state: sum.masterPassed === true ? 'passed' : sum.blockingFails > 0 ? 'failed' : sum.masterPassed === false ? 'inconclusive' : 'queued', finding: sum.notes || (sum.masterPassed === false ? 'Master verification did not pass' : 'Awaiting master verification') },
    { id: 'subjects', label: 'Subjects audited', state: sum.subjectsAudited > 0 ? 'RECORDED' : 'queued', finding: `${sum.subjectsAudited ?? 0} subject(s) audited` },
    { id: 'closure', label: 'Closure artifacts', state: sum.closureArtifactCount > 0 ? 'RECORDED' : 'queued', finding: `${sum.closureArtifactCount ?? 0} closure artifact(s)` },
    { id: 'reports', label: 'Verification reports', state: (sum.reports ?? 0) > 0 ? 'RECORDED' : 'queued', finding: `${sum.reports ?? 0} report(s)` },
  ]

  const passed = dims.filter((d: any) => d.state === 'passed').length
  return (
    <Shell breadcrumb={[{ label: 'Verification' }]}>
      <div className="page-head"><div><h1>Master verification</h1><p className="subtitle">{passed}/{dims.length} dimensions passed.</p></div>
        <button className="btn btn-primary" onClick={refresh} disabled={loading}><I name="refresh" /> Re-verify</button></div>
      <div className="card"><div style={{ display: 'grid', gap: 8 }}>
        {dims.map((d: any) => (
          <div key={d.id} className="row-between text-sm" style={{ padding: '10px 14px', borderRadius: 8, background: 'var(--surface-2)' }}>
            <div className="row" style={{ gap: 10 }}><Status status={d.state} /><span style={{ fontWeight: 600 }}>{d.label}</span><span className="id-mono">({d.id})</span></div>
            {d.finding && <span className="text-xs muted">{d.finding}</span>}
          </div>
        ))}
      </div></div>
      {dims.some((d: any) => d.state === 'failed') && (
        <div className="card mt-16" style={{ borderColor: 'var(--danger)', background: 'var(--danger-soft)' }}>
          <h4 className="mb-8" style={{ color: 'var(--danger)' }}>Failed checks</h4>
          <p className="text-sm muted mb-8">These dimensions failed. The verification engine reports what failed and what would unblock it.</p>
          {dims.filter((d: any) => d.state === 'failed').map((d: any) => (
            <div key={d.id} className="text-sm"><strong>{d.label}:</strong> {d.finding || 'No finding recorded'}</div>
          ))}
          <div className="text-sm mt-8" style={{ color: 'var(--danger)' }}>To resolve: record the missing evidence, then re-run verification.</div>
        </div>
      )}
    </Shell>
  )
}