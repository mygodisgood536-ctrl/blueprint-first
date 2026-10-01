import React, { useState, useEffect } from 'react'
import { Shell } from '../shell'
import { stagesApi } from '../api'
import { fmtDateTime, Status } from '../ui'
import { I } from '../icons2'

/* Engineering record: Testing (28), Operations (29), Continuous (30), Certification (27). */

const TEST_FILTERS = ['all', 'queued', 'recorded']

export function Testing() {
  const [loading, setLoading] = useState(true)
  const [sum, setSum] = useState<any>(null)
  const [filter, setFilter] = useState('all')

  useEffect(() => {
    stagesApi.testing().then((res: any) => {
      setSum(res)
      setLoading(false)
    }).catch(() => { setSum(null); setLoading(false) })
  }, [])

  if (loading) return <Shell breadcrumb={[{ label: 'Testing' }]}><div className="loading-screen"><div className="spinner" /></div></Shell>
  if (!sum) return <Shell breadcrumb={[{ label: 'Testing' }]}><div className="empty-state"><h3>Testing unavailable</h3><p>The testing stage has not produced a report.</p></div></Shell>

  const recorded = Boolean(sum.reportId)
  const executed = typeof sum.executed === 'number' ? sum.executed : 0
  const tests = (Array.isArray(sum.testIds) ? sum.testIds : []).map((id: string) => ({
    id,
    name: id,
    scope: 'script',
    state: recorded ? 'RECORDED' : 'queued',
    lastRun: '',
  }))
  const passed = sum.advancedToTestVerified === true ? executed : 0
  const failed = 0
  const queued = tests.filter((t: any) => t.state === 'queued').length
  const runCount = 0
  const filteredTests = filter === 'all' ? tests : tests.filter((t: any) => t.state === filter)
  const failedArr: any[] = []

  return (
    <Shell breadcrumb={[{ label: 'Testing' }]}>
      <div className="page-head">
        <div><h1>Testing</h1><p className="subtitle">What was tested, what passed, what the acceptance run reported.</p></div>
        {recorded && <span className="badge badge-green">Report generated</span>}
      </div>

      <div className="grid grid-4 mb-16">
        <div className="stat-card"><div className="stat-label">Total</div><div className="stat-value">{tests.length}</div></div>
        <div className="stat-card"><div className="stat-label">Passed</div><div className="stat-value" style={{ color: 'var(--green-600)' }}>{passed}</div></div>
        <div className="stat-card"><div className="stat-label">Failed</div><div className="stat-value" style={{ color: failed ? 'var(--danger)' : 'var(--ink-700)' }}>{failed}</div></div>
        <div className="stat-card"><div className="stat-label">Queued / running</div><div className="stat-value">{queued + runCount}</div></div>
      </div>

      <div className="card mb-16">
        <div className="row" style={{ gap: 8 }}>
          {TEST_FILTERS.map(f => (
            <button key={f} className={`seg ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {filteredTests.length === 0 ? (
        <div className="empty-state"><div className="empty-icon">&#x1F9EA;</div><h3>No tests found</h3><p>No tests match the current filter.</p></div>
      ) : (
        <div className="table-wrap"><table className="data"><thead><tr><th>Name</th><th>Scope</th><th>State</th><th>Evidence</th><th>Last run</th></tr></thead>
          <tbody>{filteredTests.map((t: any) => (
            <tr key={t.id}><td style={{ fontWeight: 600 }}>{t.name}</td><td className="text-sm muted">{t.scope}</td><td><Status status={t.state} /></td>
              <td><a href="#/evidence" className="text-sm">view evidence</a></td>
              <td className="text-sm muted">{t.lastRun ? fmtDateTime(t.lastRun) : ' --- '}</td></tr>
          ))}</tbody></table></div>
      )}

      {failed > 0 && (
        <div className="card" style={{ borderColor: 'var(--danger)', background: 'var(--danger-soft)' }}>
          <h4 className="mb-8" style={{ color: 'var(--danger)' }}>Blocking failures</h4>
          <p className="text-sm muted mb-12">Failed tests block downstream stages until resolved. Re-run all to re-attempt them.</p>
          {failedArr.map((t: any) => (
            <div key={t.id} className="text-sm"><strong>{t.name}</strong> - {t.scope}</div>
          ))}
        </div>
      )}
    </Shell>
  )
}

/* Operations (29) — the deployment record and the live telemetry observation
   as reported by the backend (no fabricated health claims). */

interface OpsEvent { id: string; kind: string; title: string; time: string; severity: 'info' | 'ok' | 'warn' | 'error'; detail: string; duration: string }

export function Operations() {
  const [deploy, setDeploy] = useState<any>(null)
  const [telemetry, setTelemetry] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([stagesApi.deployment(), stagesApi.telemetry()])
      .then(([d, t]) => { setDeploy(d); setTelemetry(t) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <Shell breadcrumb={[{ label: 'Operations' }]}><div className="loading-screen"><div className="spinner" /></div></Shell>

  const obs = telemetry?.observation
  const passed = deploy?.status === 'passed'
  const executedCount = Array.isArray(deploy?.executed) ? deploy.executed.length : 0
  const halts = Array.isArray(deploy?.docHalts) ? deploy.docHalts : []

  return (
    <Shell breadcrumb={[{ label: 'Operations' }]}>
      <div className="page-head"><div><h1>Operations</h1><p className="subtitle">The deployment record and the latest runtime observation, straight from the backend.</p></div></div>

      <div className="grid grid-2 mb-16">
        {passed ? (
          <div className="card" style={{ borderColor: 'var(--green-200)', background: 'linear-gradient(135deg, var(--green-50), var(--surface))' }}>
            <div className="row" style={{ gap: 10 }}><span style={{ width: 14, height: 14, borderRadius: '50%', background: 'var(--green-500)', flexShrink: 0 }} />
              <div><strong style={{ color: 'var(--green-700)' }}>Deployment passed</strong>
                <div className="text-sm muted">{executedCount} unit(s) deployed · manifest <span className="mono">{deploy.manifestId ?? '—'}</span> · evidence <span className="mono">{deploy.evidenceId ?? '—'}</span></div>
                <div className="text-xs muted mt-4">Boss {deploy.boss?.verdict ?? '—'} · Auditor {deploy.auditor?.verdict ?? '—'} · DoC halts: {halts.length}</div>
              </div>
            </div>
          </div>
        ) : (
          <div className="card" style={{ borderColor: 'var(--warning)', background: 'var(--warning-soft)' }}>
            <div className="text-sm"><strong>No operations run recorded yet</strong> — the deployment stage has not executed for this environment.</div>
          </div>
        )}
        <div className="card">
          <h4 className="mb-8">What needs attention</h4>
          {!obs ? (
            <p className="text-sm muted">No telemetry observation has been recorded yet.</p>
          ) : obs.breach ? (
            <p className="text-sm" style={{ color: 'var(--danger)' }}><strong>Runtime breach observed:</strong> {obs.metric} on <span className="mono">{obs.baseId}</span> is outside its threshold.</p>
          ) : (
            <p className="text-sm muted">Latest {obs.metric} observation on <span className="mono">{obs.baseId}</span> is within range.</p>
          )}
        </div>
      </div>

      <div className="card">
        <div className="row-between mb-12"><h4>Latest observation</h4>
          <span className="badge badge-gray">{obs ? (obs.breach ? 'breach' : 'nominal') : 'none'}</span></div>
        {!obs ? (
          <p className="text-sm muted mb-12">No observation yet. The runtime telemetry source has not reported for this environment.</p>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            <div className="row between text-sm"><span className="muted">Observation</span><span className="mono">{obs.id}</span></div>
            <div className="row between text-sm"><span className="muted">Base artifact</span><span className="mono">{obs.baseId}</span></div>
            <div className="row between text-sm"><span className="muted">Metric</span><span className="mono">{obs.metric}</span></div>
            <div className="row between text-sm"><span className="muted">Value</span><span className="mono">{typeof obs.value === 'object' ? JSON.stringify(obs.value) : String(obs.value)}</span></div>
            <div className="row between text-sm"><span className="muted">Breach</span><span>{obs.breach ? 'Yes' : 'No'}</span></div>
            <div className="row between text-sm"><span className="muted">Source</span><span className="mono">{obs.source || 'synthetic'}</span></div>
            <div className="row between text-sm"><span className="muted">Observed at</span><span>{obs.observedAt ? fmtDateTime(obs.observedAt) : '—'}</span></div>
            <div className="row between text-sm"><span className="muted">Evidence hash</span><span className="mono">{(obs.evidenceHash || '').slice(0, 16)}…</span></div>
          </div>
        )}
        <p className="text-xs muted mt-12">The demo environment derives its observation from a deterministic synthetic source. A breach here drives continuous discovery (recursion) and the safe-change loop.</p>
      </div>
    </Shell>
  )
}

/* Continuous engineering (30) — drift detection from the backend. */

type ChangeState = 'PENDING' | 'APPROVED' | 'REJECTED' | 'DEFERRED'

interface SafeChange { id: string; title: string; drift: string; impacts: string[]; state: ChangeState; proposedAt: string }

export function Continuous() {
  const [loading, setLoading] = useState(true)
  const [run, setRun] = useState<any>(null)

  useEffect(() => {
    stagesApi.continuous().then((res: any) => {
      setRun(res)
      setLoading(false)
    }).catch(() => { setRun(null); setLoading(false) })
  }, [])

  if (loading) return <Shell breadcrumb={[{ label: 'Continuous engineering' }]}><div className="loading-screen"><div className="spinner" /></div></Shell>
  if (!run) return <Shell breadcrumb={[{ label: 'Continuous engineering' }]}><div className="empty-state"><h3>Continuous engineering unavailable</h3><p>The continuous engineering stage has not produced a run.</p></div></Shell>

  const wr = run.workerReport || {}
  const observations = Array.isArray(wr.observations) ? wr.observations : []
  const driftObs = observations.filter((o: any) => !o.stable)
  const pendingCount = driftObs.length

  const changes: any[] = observations.map((o: any, i: number) => ({
    id: o.baseId || `obs-${i + 1}`,
    title: o.driftKind || 'Observation',
    drift: o.priorVerdict !== undefined && o.liveVerdict !== undefined ? `${o.priorVerdict} → ${o.liveVerdict}` : '',
    impacts: ([] as string[]),
    state: o.stable ? 'APPROVED' : 'PENDING',
    proposedAt: '',
  }))

  return (
    <Shell breadcrumb={[{ label: 'Continuous engineering' }]}>
      <div className="page-head"><div><h1>Continuous engineering</h1><p className="subtitle">NEXORA re-engineers the running system against its blueprint - honestly and with evidence.</p></div>
        <span className="badge badge-yellow">{pendingCount} drift item(s)</span></div>

      <div className="card mb-16" style={{ borderColor: 'var(--warning)', background: 'var(--warning-soft)' }}>
        <h4 className="mb-8" style={{ color: 'var(--ink-800)' }}>Continuous run</h4>
        {run.materialization ? (
          <p className="text-sm">{run.rationale || 'Continuous engineering materialized a certified run.'}</p>
        ) : (
          <p className="text-sm muted">No continuous engineering run has been recorded for this environment yet. Runs appear after the operations stage completes in this deployment.</p>
        )}
        <div className="row mt-8" style={{ gap: 8, flexWrap: 'wrap' }}>
          <span className="badge badge-gray">{wr.stableCount ?? '—'} stable</span>
          <span className="badge badge-red">{wr.regressedCount ?? 0} regressed</span>
          <span className="badge badge-yellow">{wr.degradedCount ?? 0} degraded</span>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 16 }}>
        {changes.map(c => (
          <div key={c.id} className="card">
            <div className="row-between mb-8">
              <div className="row" style={{ gap: 10 }}><span className="id-mono">{c.id}</span><h4 style={{ margin: 0, fontSize: 16 }}>{c.title}</h4></div>
              <Status status={c.state} />
            </div>
            {c.drift && <div className="text-sm" style={{ marginBottom: 10 }}><strong>Verdict change:</strong> {c.drift}</div>}
            <p className="text-xs muted mt-12">{c.state === 'PENDING' ? 'Drift detected against the certified baseline. Safe-change proposal is a future stage.' : 'Confirmed stable against the certified baseline.'}</p>
          </div>
        ))}
      </div>

      <div className="card mt-16" style={{ background: 'var(--green-50)', borderColor: 'var(--green-200)' }}>
        <p className="text-sm" style={{ color: 'var(--green-700)', marginBottom: 4 }}><strong>Evolution review</strong></p>
        <p className="text-sm muted">Every approved safe change enters the maintenance loop with full lineage, so the system's evolution stays traceable to evidence.</p>
      </div>
    </Shell>
  )
}

/* Certification (27) — certification dimensions from the backend. */

const REQUIRED_DIMENSIONS = ['COUNT', 'COVERAGE', 'IDENTITY', 'CORRECTNESS', 'QUALITY', 'TRACEABILITY', 'DEPENDENCY_INTEGRITY', 'DUPLICATION', 'CONFLICTS', 'CONSISTENCY', 'EVIDENCE_OF_WORK']

export function Certification() {
  const [loading, setLoading] = useState(true)
  const [sum, setSum] = useState<any>(null)

  useEffect(() => {
    stagesApi.certification().then((res: any) => {
      setSum(res ? { ...res, requiredDimensions: Array.isArray(res.requiredDimensions) && res.requiredDimensions.length > 0 ? res.requiredDimensions : REQUIRED_DIMENSIONS } : null)
      setLoading(false)
    }).catch(() => { setSum(null); setLoading(false) })
  }, [])

  if (loading) return <Shell breadcrumb={[{ label: 'Certification' }]}><div className="loading-screen"><div className="spinner" /></div></Shell>
  if (!sum) return <Shell breadcrumb={[{ label: 'Certification' }]}><div className="empty-state"><h3>Certification unavailable</h3><p>The certification stage has not produced a verdict.</p></div></Shell>

  const present = new Set(sum.presentDimensions || [])
  const missing = new Set(sum.missingDimensions || [])
  const dims = (sum.requiredDimensions as string[]).map((id: string) => ({
    id,
    label: id,
    state: present.has(id) ? 'passed' : missing.has(id) ? 'inconclusive' : 'queued',
    finding: present.has(id) ? 'Present' : missing.has(id) ? 'Missing evidence' : 'Not yet run',
  }))
  const passed = dims.filter((d: any) => d.state === 'passed').length
  const failed = dims.filter((d: any) => d.state === 'failed')
  const inconclusive = dims.filter((d: any) => d.state === 'inconclusive')
  const missingDims = [...failed, ...inconclusive]
  const isCertifiable = sum.certifiable === true && failed.length === 0 && inconclusive.length === 0

  return (
    <Shell breadcrumb={[{ label: 'Certification' }]}>
      <div className="page-head"><div><h1>Certification</h1><p className="subtitle">Certification is granted by the verification engine during a pipeline run — there is no manual request endpoint.</p></div>
        <span className={`badge ${sum.certified === true ? 'badge-green' : sum.certified === false ? 'badge-red' : 'badge-gray'}`}>{sum.certified === true ? 'Certified' : sum.certified === false ? 'Denied' : 'Pending'}</span>
      </div>
      {isCertifiable ? (
        <div className="card mb-16" style={{ borderColor: 'var(--green-200)', background: 'linear-gradient(135deg, var(--green-50), var(--surface))' }}>
          <div className="row" style={{ gap: 10 }}><span style={{ fontSize: 20 }}>&#10003;</span><div><strong style={{ color: 'var(--green-700)' }}>Certified</strong><div className="text-sm muted">All {dims.length} required verification dimensions passed. Certification recorded.</div></div></div>
        </div>
      ) : (
        <div className="card mb-16" style={{ borderColor: 'var(--warning)', background: 'var(--warning-soft)' }}>
          <div className="row" style={{ gap: 10 }}><span style={{ fontSize: 20 }}>&#9888;</span><div><strong>Not yet certified</strong><div className="text-sm muted">{failed.length} dimension(s) failed, {inconclusive.length} inconclusive. The certification authority requires every required dimension to be present.</div></div></div>
        </div>
      )}

      <div className="card mb-16">
        <div className="row-between mb-12">
          <h4>Verification dimensions</h4>
          <span className="badge badge-gray">{passed}/{dims.length} present</span>
        </div>
        <div style={{ display: 'grid', gap: 6 }}>
          {REQUIRED_DIMENSIONS.map(d => {
            const dim = dims.find((x: any) => x.id === d)
            return (
              <div key={d} className="row-between text-sm" style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--surface-2)' }}>
                <div className="row" style={{ gap: 10 }}>
                  <span className="id-mono">{d}</span>
                  {dim?.finding && <span className="text-xs muted">{dim.finding}</span>}
                </div>
                {dim ? <Status status={dim.state} /> : <span className="badge badge-gray">not-run</span>}
              </div>
            )
          })}
        </div>
      </div>
    {!isCertifiable && (
      <div className="card" style={{ borderColor: 'var(--danger)', background: 'var(--danger-soft)' }}>
        <h4 className="mb-12" style={{ color: 'var(--danger)' }}>Missing dimensions</h4>
        {missingDims.length === 0 ? <p className="text-sm muted">All dimensions present.</p> : (
          <div style={{ display: 'grid', gap: 8 }}>
            {missingDims.map((d: any) => (
              <div key={d.id} className="text-sm">
                <strong>{d.label}:</strong> {d.finding || 'Missing evidence'}{d.state === 'inconclusive' ? ' (inconclusive - re-verification required)' : ''}
                <div className="text-xs muted">To resolve: {d.state === 'failed' ? 'record the missing evidence and re-run verification' : 're-run verification to reach a conclusive state'}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
    }
    </Shell>
  )
}
