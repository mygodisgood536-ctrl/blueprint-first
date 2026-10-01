import React, { useState, useEffect } from 'react'
import { Shell } from '../shell'
import { useStore } from '../store'
import { Status, fmtDateTime } from '../ui'
import { I } from '../icons2'
import { stagesApi, artifactsApi, dependencyMapApi, lineageApi, evidenceApi, api, ApiProjectAiConfig } from '../api'
import { ALL_STAGES } from '../mock/data'
import { InstructionComposer } from '../selector'
import { AiModelControl } from '../modelPopup'

/* §80.2 — deep link to a deleted (or unknown) project shows an honest state. */
function ProjectDeletedState() {
  return (
    <div className="card" style={{ textAlign: 'center', padding: '48px 24px' }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>&#128465;&#65039;</div>
      <h2 style={{ marginBottom: 6 }}>Project not found</h2>
      <p className="muted text-sm" style={{ marginBottom: 20 }}>This project was deleted. Its uploaded documents remain in your library.</p>
      <div className="row" style={{ justifyContent: 'center', gap: 10 }}>
        <a href="#/projects" className="btn btn-primary">Back to projects</a>
        <a href="#/documents" className="btn btn-ghost">View documents</a>
      </div>
    </div>
  )
}

const numOf = (stageId: string) => ALL_STAGES.find(s => s.id === stageId)?.num ?? ''

export function ProjectWorkspace({ id }: { id: string }) {
  const { pushToast, getProject, runProjectStage, approveProject } = useStore()
  const [project, setProject] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('overview')
  const [busyStage, setBusyStage] = useState<string | null>(null)
  const [approving, setApproving] = useState(false)

  const reload = async () => {
    try {
      setProject(await getProject(id))
    } catch { /* last-known state stays */ }
  }

  useEffect(() => {
    let alive = true
    const loadProject = async () => {
      try {
        const p = await getProject(id)
        if (alive) setProject(p)
      } catch (err) {
        console.error('Failed to load project:', err)
      } finally {
        if (alive) setLoading(false)
      }
    }
    loadProject()
    return () => { alive = false }
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  const inScope = (p: any) => p ? p.stages.filter((s: any) => s.inScope).length : 0
  const recordedCount = (p: any) => p ? p.stages.filter((s: any) => s.status === 'RECORDED').length : 0

  /* Run a stage through the real project ledger. The backend rejects
     repeats (already recorded), out-of-scope, and unknown stages honestly,
     and the failure text is shown to the user unchanged. */
  const handleRunStage = async (s: any, instruction?: string) => {
    if (busyStage || !project) return
    setBusyStage(s.id)
    pushToast(instruction ? `${s.label} queued with instruction` : `${s.label} queued`, 'info')
    try {
      await runProjectStage(project.id, s.id, instruction || undefined)
      await reload()
    } catch {
      /* toast already shown by the store */
    } finally {
      setBusyStage(null)
    }
  }

  const handleApprove = async () => {
    if (!project || approving) return
    setApproving(true)
    try {
      await approveProject(project.id)
      await reload()
    } catch {
      /* toast already shown by the store */
    } finally {
      setApproving(false)
    }
  }

  /* The project AI configuration is saved through the governed project
     configuration endpoint and reflected on the page afterwards. */
  const handleAiConfig = async (cfg: ApiProjectAiConfig | null) => {
    await api.projects.updateAiConfig(project.id, cfg)
    await reload()
    pushToast(cfg ? 'AI model configured' : 'AI model removed', 'success')
  }

  if (loading) return <Shell breadcrumb={[{ label: 'Projects', route: '#/projects' }, { label: 'Loading...' }]}><div className="loading-screen"><div className="spinner" /></div></Shell>
  if (!project) return <Shell breadcrumb={[{ label: 'Projects', route: '#/projects' }, { label: 'Not found' }]}><ProjectDeletedState /></Shell>

  const nextStage = project.stages.find((s: any) => s.inScope && s.status === 'PENDING')
  const currentStage = [...project.stages].reverse().find((s: any) => s.inScope && s.status === 'RECORDED') || project.stages.find((s: any) => s.inScope)
  const recorded = recordedCount(project)
  const blueprintStage = project.stages.find((s: any) => s.id === 'blueprint')
  const blueprintRecorded = blueprintStage?.inScope && blueprintStage.status === 'RECORDED'
  const approved = project.approval?.status === 'APPROVED'

  return (
    <Shell breadcrumb={[{ label: 'Projects', route: '#/projects' }, { label: project.name }]}>
      {/* Top band */}
      <div className="card mb-16">
        <div className="row-between" style={{ flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div className="row" style={{ gap: 10, marginBottom: 6 }}><h1 style={{ fontSize: 24 }}>{project.name}</h1><Status status={project.status} /><span className="badge badge-gray">{project.mode}</span></div>
            <div className="text-sm muted id-mono">{project.id} · Last activity {fmtDateTime(project.lastActivity)}</div>
            <p className="text-sm muted mt-8" style={{ maxWidth: 600 }}>{project.description}</p>
          </div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <AiModelControl value={project.aiConfig ?? null} onChange={handleAiConfig} />
            <a href={`#/projects/${project.id}/execution`} className="btn btn-ghost"><I name="activity" /> Execution</a>
            <a href={`#/projects/${project.id}/settings`} className="btn btn-ghost"><I name="settings" /> Settings</a>
          </div>
        </div>
      </div>

      {/* Lifecycle strip */}
      <div className="card mb-16">
        <h4 className="mb-12">Lifecycle</h4>
        <div className="lifecycle-strip">
          {project.stages.map((s: any, i: number) => (
            <React.Fragment key={s.id}>
              <div className={`stage-chip ${s.status === 'RECORDED' ? 'done' : ''} ${s.id === currentStage?.id ? 'current' : ''} ${!s.inScope ? 'out' : ''}`}>
                <span className="stage-num">{numOf(s.id)}</span> {s.label}
              </div>
              {i < project.stages.length - 1 && <span className="lifecycle-sep"><I name="arrowRight" size={14} /></span>}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Action bar + instruction composer */}
      <div className="card mb-16">
        <div className="row-between" style={{ gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
          <div>
            <div style={{ fontWeight: 600 }}>Current: {currentStage?.label || '—'}</div>
            <div className="text-sm muted">{recorded} of {inScope(project)} in-scope stages recorded</div>
          </div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {blueprintRecorded && !approved && (
              <button className="btn btn-outline-green" onClick={handleApprove} disabled={approving || !!busyStage}>
                <I name="check" size={16} /> {approving ? 'Approving…' : 'Approve blueprint'}
              </button>
            )}
            {approved && <span className="badge badge-green">Blueprint approved</span>}
            {busyStage && <div className="text-sm" style={{ color: 'var(--green-600)' }}><span className="spin" /> {busyStage}…</div>}
          </div>
        </div>
        <InstructionComposer
          stageLabel={nextStage ? nextStage.label : null}
          busy={!!busyStage}
          onRun={(instruction) => { if (nextStage) void handleRunStage(nextStage, instruction) }}
          projectAiConfig={project.aiConfig ?? null}
        />
        {blueprintStage?.inScope && !blueprintRecorded && (
          <div className="hint mt-8">Run the Blueprint stage to unlock the human-approval gate ({project.mode} mode).</div>
        )}
      </div>

      {/* Tabbed content */}
      <div className="card">
        <div className="tabs">
          {['overview', 'artifacts', 'evidence', 'lineage', 'dependency-map', 'expansion', 'twin', 'traceability', 'verification', 'testing', 'operations', 'continuous'].map(t => (
            <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
              {t.charAt(0).toUpperCase() + t.slice(1).replace(/-/g, ' ')}
            </button>
          ))}
        </div>
        <div className="mt-16">
          {tab === 'overview' && <OverviewTab project={project} />}
          {tab === 'artifacts' && <ArtifactsTab project={project} />}
          {tab === 'evidence' && <EvidenceTab project={project} />}
          {tab === 'lineage' && <LineageTab project={project} />}
          {tab === 'dependency-map' && <DependencyMapTab project={project} />}
          {tab === 'expansion' && <ExpansionTab />}
          {tab === 'twin' && <TwinTab />}
          {tab === 'traceability' && <TraceabilityTab project={project} />}
          {tab === 'verification' && <VerificationTab project={project} />}
          {tab === 'testing' && <TestingTab project={project} />}
          {tab === 'operations' && <OperationsTab project={project} />}
          {tab === 'continuous' && <ContinuousTab project={project} />}
        </div>
      </div>
    </Shell>
  )
}

/* Overview tab */
function OverviewTab({ project }: { project: any }) {
  const recordedStages = project.stages.filter((s: any) => s.status === 'RECORDED')
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="card"><h4 className="mb-12">Project summary</h4>
        <div style={{ display: 'grid', gap: 8 }}>
          <div className="row-between text-sm"><span className="muted">Mode</span><span>{project.mode}</span></div>
          <div className="row-between text-sm"><span className="muted">Status</span><span><Status status={project.status} /></span></div>
          <div className="row-between text-sm"><span className="muted">Lifecycle progress</span><span>{recordedStages.length} / {project.stages.filter((s: any) => s.inScope).length}</span></div>
          <div className="row-between text-sm"><span className="muted">Blueprint approval</span><span>{project.approval ? `${project.approval.status} · by ${project.approval.approvedBy} · ${fmtDateTime(project.approval.approvedAt)}` : 'Not yet'}</span></div>
          <div className="row-between text-sm"><span className="muted">Created</span><span>{project.createdAt ? fmtDateTime(project.createdAt) : '—'}</span></div>
          <div className="row-between text-sm"><span className="muted">Last activity</span><span>{project.lastActivity ? fmtDateTime(project.lastActivity) : '—'}</span></div>
        </div>
      </div>
      {recordedStages.length > 0 && (
        <div className="card"><h4 className="mb-12">Recorded lifecycle ledger</h4>
          <div style={{ display: 'grid', gap: 8 }}>
            {recordedStages.map((s: any) => (
              <div key={s.id} className="row-between text-sm">
                <span><span className="mono" style={{ marginRight: 8 }}>{numOf(s.id)}</span>{s.label}</span>
                <span className="muted">{s.at ? fmtDateTime(s.at) : '—'}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/* Tabbed panels — wired to the same backend endpoints as the dedicated pages,
   rendered here as compact summaries with a link to the full page. Endpoints
   the engine exposes only at an engine-wide level say so explicitly. */

function TabShell({ title, note, fullLabel, href, children }: { title: string; note?: string; fullLabel: string; href: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="row-between mb-12">
        <div><h4 style={{ margin: 0 }}>{title}</h4>{note && <p className="text-sm muted mt-4 mb-0">{note}</p>}</div>
        <a href={href} className="btn btn-ghost btn-sm">{fullLabel} <I name="arrowRight" size={14} /></a>
      </div>
      {children}
    </div>
  )
}

function useFetch<T>(fn: () => Promise<T>) {
  const [state, setState] = useState<{ loading: boolean; data: T | null; error: boolean }>({ loading: true, data: null, error: false })
  useEffect(() => {
    let alive = true
    fn().then((d) => { if (alive) setState({ loading: false, data: d, error: false }) })
      .catch(() => { if (alive) setState({ loading: false, data: null, error: true }) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return state
}

const ENGINE_WIDE = 'Engine-scope data — this endpoint reflects the running pipeline, not a single project.'

function ArtifactsTab({ project }: { project: any }) {
  const { loading, data, error } = useFetch(artifactsApi.list)
  const mine = data?.artifacts.filter((a: any) => a.projectId === project.id) ?? []
  return (
    <TabShell title="Artifacts" fullLabel="Open Artifacts" href="#/artifacts">
      {loading ? <p className="text-sm muted">Loading…</p> : error ? <p className="text-sm muted">Artifact engine unavailable.</p> :
        mine.length === 0 ? <p className="text-sm muted">No recorded artifacts for this project yet — run lifecycle stages to produce them.</p> : (
          <div style={{ display: 'grid', gap: 6 }}>
            {mine.slice(0, 12).map((a: any) => (
              <a key={a.id} href={`#/artifacts/${a.id}`} className="row-between text-sm" style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--surface-2)' }}>
                <span><strong>{a.title || a.id}</strong> <span className="id-mono text-xs muted">{a.id}</span></span>
                <span className="badge badge-gray">{a.type}</span>
              </a>
            ))}
            {mine.length > 12 && <p className="text-xs muted">…and {mine.length - 12} more. Full page shows everything.</p>}
          </div>
        )}
    </TabShell>
  )
}

function EvidenceTab({ project }: { project: any }) {
  const { loading, data, error } = useFetch(evidenceApi.list)
  const entries: any[] = data?.entries ?? []
  return (
    <TabShell title="Evidence" note={ENGINE_WIDE} fullLabel="Open Evidence" href="#/evidence">
      {loading ? <p className="text-sm muted">Loading…</p> : error ? <p className="text-sm muted">Evidence engine unavailable.</p> :
        entries.length === 0 ? <p className="text-sm muted">No evidence records yet — evidence is produced as stages execute.</p> : (
          <div>
            <p className="text-sm mb-8"><strong>{entries.length}</strong> evidence record(s) engine-wide.</p>
            <div style={{ display: 'grid', gap: 6 }}>
              {entries.slice(0, 8).map((e: any) => (
                <div key={e.id} className="row-between text-sm" style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--surface-2)' }}>
                  <span className="id-mono text-xs">{e.id}</span><span>{e.summary}</span>
                </div>
              ))}
            </div>
          </div>
        )}
    </TabShell>
  )
}

function LineageTab({ project }: { project: any }) {
  const { loading, data, error } = useFetch(lineageApi.get)
  const gaps = data?.gaps ?? []
  return (
    <TabShell title="Lineage" note={ENGINE_WIDE} fullLabel="Open Lineage" href="#/lineage">
      {loading ? <p className="text-sm muted">Loading…</p> : error ? <p className="text-sm muted">Lineage engine unavailable.</p> : (
        <div style={{ display: 'grid', gap: 6 }}>
          <div className="row-between text-sm"><span className="muted">First page</span><span className="mono">{data!.firstPageId || '—'}</span></div>
          <div className="row-between text-sm"><span className="muted">Complete through</span><span className="mono">{data!.completeThrough || '—'}</span></div>
          <div className="row-between text-sm"><span className="muted">Gaps</span><span>{gaps.length > 0 ? `${gaps.length} gap(s)` : 'None — chain is complete'}</span></div>
        </div>
      )}
    </TabShell>
  )
}

function DependencyMapTab({ project }: { project: any }) {
  const { loading, data, error } = useFetch(dependencyMapApi.get)
  return (
    <TabShell title="Dependency map" note={ENGINE_WIDE} fullLabel="Open Dependency map" href="#/dependency-map">
      {loading ? <p className="text-sm muted">Loading…</p> : error ? <p className="text-sm muted">Dependency engine unavailable.</p> : (
        <div style={{ display: 'grid', gap: 6 }}>
          <div className="row-between text-sm"><span className="muted">Nodes</span><span>{data!.nodeCount}</span></div>
          <div className="row-between text-sm"><span className="muted">Edges</span><span>{data!.edgeCount}</span></div>
          <div className="row-between text-sm"><span className="muted">Sample relations</span><span className="mono">{data!.edges.slice(0, 3).map((e: any) => e.relation).join(', ') || '—'}</span></div>
        </div>
      )}
    </TabShell>
  )
}

function ExpansionTab() {
  const { loading, data, error } = useFetch(stagesApi.expansion)
  const ready = (data as any)?.status === 'READY'
  const tally = (data as any)?.tally || {}
  return (
    <TabShell title="Recursive page expansion" note={ENGINE_WIDE} fullLabel="Open Expansion" href="#/expansion">
      {loading ? <p className="text-sm muted">Loading…</p> : error ? <p className="text-sm muted">Expansion engine unavailable.</p> :
        !ready ? <p className="text-sm muted">Expansion pending — runs with the Level-3 Discovery Department.</p> : (
          <div style={{ display: 'grid', gap: 6 }}>
            <div className="row-between text-sm"><span className="muted">Pages expanded</span><span>{(data as any).pages.length} × 14 layers</span></div>
            <div className="row-between text-sm"><span className="muted">Layers added</span><span>{tally.added ?? 0}</span></div>
            <div className="row-between text-sm"><span className="muted">Blocked (routed)</span><span>{tally.blocked ?? 0}</span></div>
            <div className="row-between text-sm"><span className="muted">Exit condition</span><span>{(data as any).pages.every((p: any) => p.allLayersDetermined) ? 'All layers determined' : 'Incomplete'}</span></div>
          </div>
        )}
    </TabShell>
  )
}

function TwinTab() {
  const { loading, data, error } = useFetch(stagesApi.twin)
  const built = (data as any)?.built === true
  return (
    <TabShell title="Digital twin" note={ENGINE_WIDE} fullLabel="Open Digital Twin" href="#/twin">
      {loading ? <p className="text-sm muted">Loading…</p> : error ? <p className="text-sm muted">Twin engine unavailable.</p> :
        !built ? <p className="text-sm muted">Twin not built — materializes after the Design Department certifies coverage.</p> : (
          <div style={{ display: 'grid', gap: 6 }}>
            <div className="row-between text-sm"><span className="muted">Pages</span><span>{(data as any).pages.length}</span></div>
            <div className="row-between text-sm"><span className="muted">Elements</span><span>{(data as any).elementCount}</span></div>
            <div className="row-between text-sm"><span className="muted">Design-bound</span><span>{(data as any).boundElementCount}</span></div>
            <div className="row-between text-sm"><span className="muted">Gaps</span><span>{(data as any).gapCount}</span></div>
          </div>
        )}
    </TabShell>
  )
}

function TraceabilityTab({ project }: { project: any }) {
  const { loading, data, error } = useFetch(stagesApi.traceability)
  return (
    <TabShell title="Traceability" note={ENGINE_WIDE} fullLabel="Open Traceability" href="#/traceability">
      {loading ? <p className="text-sm muted">Loading…</p> : error ? <p className="text-sm muted">Traceability engine unavailable.</p> : (
        <div style={{ display: 'grid', gap: 6 }}>
          <div className="row-between text-sm"><span className="muted">Requirements</span><span>{(data as any).totalRequirements ?? ((data as any).rows ?? []).length}</span></div>
          <div className="row-between text-sm"><span className="muted">Fully traced</span><span>{(data as any).fullyTraced ?? 0}</span></div>
          <div className="row-between text-sm"><span className="muted">Complete</span><span>{(data as any).complete === true ? 'Yes' : 'No'}</span></div>
        </div>
      )}
    </TabShell>
  )
}

function VerificationTab({ project }: { project: any }) {
  const { loading, data, error } = useFetch(stagesApi.verification)
  return (
    <TabShell title="Verification" note={ENGINE_WIDE} fullLabel="Open Verification" href="#/verification">
      {loading ? <p className="text-sm muted">Loading…</p> : error ? <p className="text-sm muted">Verification engine unavailable.</p> : (
        <div style={{ display: 'grid', gap: 6 }}>
          <div className="row-between text-sm"><span className="muted">Master pass</span><span>{data!.masterPassed === true ? 'Passed' : 'Not passed'}</span></div>
          <div className="row-between text-sm"><span className="muted">Blocking failures</span><span>{data!.blockingFails ?? 0}</span></div>
          <div className="row-between text-sm"><span className="muted">Subjects audited</span><span>{data!.subjectsAudited ?? 0}</span></div>
          <div className="row-between text-sm"><span className="muted">Reports</span><span>{data!.reports ?? 0}</span></div>
        </div>
      )}
    </TabShell>
  )
}

function TestingTab({ project }: { project: any }) {
  const { loading, data, error } = useFetch(stagesApi.testing)
  const executed = typeof data?.executed === 'number' ? data.executed : 0
  const testIds = Array.isArray(data?.testIds) ? data.testIds : []
  const passed = data?.advancedToTestVerified === true ? executed : 0
  return (
    <TabShell title="Testing" note={ENGINE_WIDE} fullLabel="Open Testing" href="#/testing">
      {loading ? <p className="text-sm muted">Loading…</p> : error ? <p className="text-sm muted">Testing engine unavailable.</p> : (
        <div style={{ display: 'grid', gap: 6 }}>
          <div className="row-between text-sm"><span className="muted">Executed</span><span>{executed}</span></div>
          <div className="row-between text-sm"><span className="muted">Advanced to verified</span><span>{passed}</span></div>
          <div className="row-between text-sm"><span className="muted">Test cases</span><span>{testIds.length}</span></div>
        </div>
      )}
    </TabShell>
  )
}

function OperationsTab({ project }: { project: any }) {
  const dep = useFetch(stagesApi.deployment)
  const tel = useFetch(stagesApi.telemetry)
  const { loading, data, error } = dep
  const obs: any = tel.data?.observation ?? null
  return (
    <TabShell title="Operations" note={ENGINE_WIDE} fullLabel="Open Operations" href="#/operations">
      {loading ? <p className="text-sm muted">Loading…</p> : error ? <p className="text-sm muted">Operations engine unavailable.</p> : (
        <div style={{ display: 'grid', gap: 6 }}>
          <div className="row-between text-sm"><span className="muted">Deployment</span><span><Status status={data!.status} /></span></div>
          <div className="row-between text-sm"><span className="muted">Stages executed</span><span>{data!.executed}</span></div>
          <div className="row-between text-sm"><span className="muted">Latest observation</span><span>{obs ? `${obs.metric} ${obs.breach ? '· breach' : '· nominal'}` : 'None yet'}</span></div>
        </div>
      )}
    </TabShell>
  )
}

function ContinuousTab({ project }: { project: any }) {
  const { loading, data, error } = useFetch(stagesApi.continuous)
  const wr: any = data?.workerReport || {}
  return (
    <TabShell title="Continuous engineering" note={ENGINE_WIDE} fullLabel="Open Continuous" href="#/continuous">
      {loading ? <p className="text-sm muted">Loading…</p> : error ? <p className="text-sm muted">Continuous engineering unavailable.</p> : (
        <div style={{ display: 'grid', gap: 6 }}>
          <div className="row-between text-sm"><span className="muted">Stable</span><span>{wr.stableCount ?? '—'}</span></div>
          <div className="row-between text-sm"><span className="muted">Regressed</span><span>{wr.regressedCount ?? 0}</span></div>
          <div className="row-between text-sm"><span className="muted">Degraded</span><span>{wr.degradedCount ?? 0}</span></div>
          <div className="row-between text-sm"><span className="muted">Run recorded</span><span>{data!.materialization ? 'Yes' : 'No'}</span></div>
        </div>
      )}
    </TabShell>
  )
}