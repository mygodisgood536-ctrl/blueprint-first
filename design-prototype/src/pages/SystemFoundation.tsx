import React, { useState, useEffect } from 'react'
import { Shell } from '../shell'
import { systemApi, ApiFoundationReport } from '../api'
import { I } from '../icons2'

/* Platform Startup Gate — the honest, live capability-first state of the real
   execution foundation (OpenCode / Cline / Daytona / local workspace). The
   report is re-probed against the host on every load: an absent component is
   shown as NOT_INSTALLED (never faked), and the moment a required CLI is
   installed the platform reports it and binds new environments to the real
   backend without a restart. Nothing here claims production readiness the
   discovery did not verify. */

const STATUS_BADGE: Record<string, { text: string; cls: string }> = {
  READY: { text: 'Ready', cls: 'badge-green' },
  PROVISIONING: { text: 'Provisioning', cls: 'badge-yellow' },
  STARTING: { text: 'Starting', cls: 'badge-yellow' },
  RECOVERING: { text: 'Recovering', cls: 'badge-yellow' },
  NETWORK_UNAVAILABLE: { text: 'Network unavailable', cls: 'badge-red' },
  DEGRADED: { text: 'Degraded', cls: 'badge-yellow' },
  FAILED: { text: 'Failed', cls: 'badge-red' },
  TERMINATED: { text: 'Terminated', cls: 'badge-gray' },
  INCOMPATIBLE: { text: 'Incompatible', cls: 'badge-red' },
  NOT_INSTALLED: { text: 'Not installed', cls: 'badge-red' },
}

const CAPABILITY_ORDER = ['opencode', 'cline', 'daytona', 'local-workspace']
const CAPABILITY_LABEL: Record<string, string> = {
  opencode: 'OpenCode AI execution',
  cline: 'Cline Worker/agent execution',
  daytona: 'Daytona project environments',
  'local-workspace': 'Local workspace adapter',
}

export function SystemFoundation() {
  const [loading, setLoading] = useState(true)
  const [report, setReport] = useState<ApiFoundationReport | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const refresh = () => {
    setLoading(true)
    systemApi.foundation().then((res: ApiFoundationReport) => {
      setReport(res)
      setNote(null)
      setLoading(false)
    }).catch((e: Error) => { setReport(null); setNote(e.message); setLoading(false) })
  }

  useEffect(refresh, [])

  if (loading) return <Shell breadcrumb={[{ label: 'System' }]}><div className="loading-screen"><div className="spinner" /></div></Shell>

  if (!report) return (
    <Shell breadcrumb={[{ label: 'System' }]}>
      <div className="page-head"><div><h1>Platform foundation</h1></div></div>
      <div className="card"><p className="text-sm">{note ?? 'The foundation report is not available in this build.'}</p></div>
    </Shell>
  )

  const rows = CAPABILITY_ORDER
    .map((cap) => report.capabilities.find((c) => c.capability === cap) ?? null)
    .filter((c): c is NonNullable<typeof c> => c !== null)
  const mandatory = ['opencode', 'cline', 'daytona'] as const
  const readyCount = mandatory.filter((cap) => {
    const d = report.capabilities.find((c) => c.capability === cap)
    return d?.status === 'READY'
  }).length

  return (
    <Shell breadcrumb={[{ label: 'System' }]}>
      <div className="page-head">
        <div><h1>Platform foundation</h1>
          <p className="subtitle">The real, live state of the execution foundation. Missing components are reported as missing — never simulated, never claimed.</p></div>
        <button className="btn btn-primary" onClick={refresh} disabled={loading}><I name="refresh" /> Re-probe host</button>
      </div>

      <div className="grid grid-5 mb-16">
        <div className="stat-card">
          <div className="stat-label">Policy</div>
          <div className="stat-value">{report.policy === 'production' ? 'Production' : 'Development · local'}</div>
          <div className="stat-sub">{report.policy === 'production' ? 'All mandatory components verified' : 'Absent members do not block honest local work'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Mandatory ready</div>
          <div className="stat-value">{readyCount}/3</div>
          <div className="stat-sub">OpenCode · Cline · Daytona</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Environment backend</div>
          <div className="stat-value">{report.environmentBackend === 'daytona' ? 'Daytona' : 'Local workspace'}</div>
          <div className="stat-sub">Backs new environments right now</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Production ready</div>
          <div className="stat-value">{report.productionReady ? 'Yes' : 'No'}</div>
          <div className="stat-sub">All three mandatory components READY</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Startup gate</div>
          <div className="stat-value">{report.startupGateOpen ? 'Open' : 'Closed'}</div>
          <div className="stat-sub">Components + control-plane probes</div>
        </div>
      </div>

      <div className="card mb-16">
        <div className="row-between">
          <div className="stat-label">Startup gate summary</div>
          {report.startupGateOpen
            ? <span className="badge badge-green">Startup gate open</span>
            : <span className="badge badge-red">Startup gate closed</span>}
        </div>
        <p className="text-sm muted mt-8" style={{ lineHeight: 1.6 }}>{report.summary}</p>
      </div>

      <div className="card mb-16">
        <h4 className="mb-8">Control-plane foundation probes</h4>
        <p className="text-sm muted mb-12">
          Each foundation the startup gate names is verified with a real operation at boot — a real durable
          write, a real event round trip, a real scheduler pass, a real secret-boundary check, a real evidence
          append. A degraded foundation is never represented as ready.
        </p>
        <div className="table-wrap"><table className="data">
          <thead><tr><th>Foundation</th><th>Probe</th><th>What was actually done</th></tr></thead>
          <tbody>
            {(report.controlPlane ?? []).map((c) => (
              <tr key={c.capability}>
                <td className="text-sm" style={{ fontWeight: 600 }}>{c.capability}</td>
                <td><span className={`badge ${c.ready ? 'badge-green' : 'badge-red'}`}>{c.ready ? 'Passed' : 'Failed'}</span></td>
                <td className="text-sm muted" style={{ maxWidth: 620 }}>{c.detail}</td>
              </tr>
            ))}
            {(report.controlPlane ?? []).length === 0 && (
              <tr><td colSpan={3} className="text-sm muted">No control-plane probe results were reported by this build.</td></tr>
            )}
          </tbody>
        </table></div>
      </div>

      <div className="card">
        <h4 className="mb-8">Execution capabilities — live probe</h4>
        <div className="table-wrap"><table className="data">
          <thead><tr><th>Component</th><th>Status</th><th>Mechanism</th><th>Version</th><th>Rationale</th></tr></thead>
          <tbody>
            {rows.map((c) => {
              const meta = STATUS_BADGE[c.status] || { text: c.status, cls: 'badge-gray' }
              return (
                <tr key={c.capability}>
                  <td className="text-sm" style={{ fontWeight: 600 }}>{CAPABILITY_LABEL[c.capability] ?? c.capability}</td>
                  <td><span className={`badge ${meta.cls}`}>{meta.text}</span></td>
                  <td className="text-sm muted">{c.mechanism ?? '—'}</td>
                  <td className="text-xs mono">{c.version ?? '—'}</td>
                  <td className="text-sm muted" style={{ maxWidth: 460 }}>{c.rationale}</td>
                </tr>
              )
            })}
          </tbody>
        </table></div>
        <p className="text-xs muted mt-8">Capabilities are re-probed against this host on every load and the decision + rationale are recorded as durable evidence. A newly installed Cline or Daytona CLI lifts the platform to ready without a restart.</p>
      </div>
    </Shell>
  )
}