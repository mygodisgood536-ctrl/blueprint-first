import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Shell } from '../shell'
import { Status, fmtDateTime } from '../ui'
import { I } from '../icons2'
import {
  executionApi,
  ApiJobRecord,
  ApiEnvRecord,
  ApiExecutionEvent,
  ApiExecutionGraph,
  ApiSupervisorSnapshot,
} from '../api'

/* § 3.3 START-TO-FINISH EXECUTION CONTRACT + TRANSPARENCY IS AUTHORITATIVE
   STATE, NOT ANIMATION (lines 205, 207-209).

   This page is the Transparency Frontend: a pure projection of persisted
   backend execution state. Every value rendered here comes from the real
   Execution Supervisor, the durable Job State Manager, the durable event bus,
   the real execution environment (files, terminal, git) and the Execution
   Graph. Nothing is animated, simulated or invented: the live event rail is
   fed by the server-sent event stream, and a reconnect replays the durable
   log from the last sequence number the client actually saw. */

type Tab = 'supervision' | 'jobs' | 'environments' | 'graph' | 'events'

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'supervision', label: 'Supervision' },
  { key: 'jobs', label: 'Worker jobs' },
  { key: 'environments', label: 'Environments' },
  { key: 'graph', label: 'Execution graph' },
  { key: 'events', label: 'Event stream' },
]

export function Execution({ projectId }: { projectId?: string }) {
  const [tab, setTab] = useState<Tab>('supervision')
  const [supervisor, setSupervisor] = useState<ApiSupervisorSnapshot | null>(null)
  const [jobs, setJobs] = useState<ApiJobRecord[]>([])
  const [envs, setEnvs] = useState<ApiEnvRecord[]>([])
  const [graph, setGraph] = useState<ApiExecutionGraph | null>(null)
  const [events, setEvents] = useState<ApiExecutionEvent[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [live, setLive] = useState(false)
  const lastSeq = useRef(0)
  const source = useRef<EventSource | null>(null)

  const reload = useCallback(async () => {
    try {
      const [sup, j, e] = await Promise.all([
        executionApi.supervisor(),
        executionApi.jobs(projectId),
        executionApi.environments(projectId),
      ])
      setSupervisor(sup)
      setJobs(j.jobs)
      setEnvs(e.environments)
      if (projectId) setGraph(await executionApi.graph(projectId))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The execution control plane is unavailable.')
    }
  }, [projectId])

  useEffect(() => {
    void reload()
  }, [reload])

  /* The real-time leg: server-sent events straight from the durable event bus.
     On (re)connect the client asks for everything after the last sequence it
     actually saw, so a reconnect reconstructs the same state from persistence
     rather than showing a fabricated or reset view. */
  useEffect(() => {
    if (!projectId) return
    const open = () => {
      const es = new EventSource(executionApi.streamUrl(projectId, lastSeq.current))
      source.current = es
      es.onopen = () => setLive(true)
      es.onerror = () => setLive(false)
      es.onmessage = (msg) => {
        try {
          const evt = JSON.parse(msg.data) as ApiExecutionEvent
          if (typeof evt.seq === 'number' && evt.seq > lastSeq.current) lastSeq.current = evt.seq
          setEvents((prev) => [...prev, evt].slice(-200))
        } catch {
          /* a non-event frame (comment/heartbeat) carries no state */
        }
      }
    }
    open()
    return () => {
      source.current?.close()
      source.current = null
      setLive(false)
    }
  }, [projectId])

  const act = async (fn: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true)
    try {
      await fn()
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The action was rejected.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Shell
      breadcrumb={[
        { label: 'Projects', route: '#/projects' },
        ...(projectId ? [{ label: 'Execution' }] : [{ label: 'Execution' }]),
      ]}
    >
      <div className="card mb-16">
        <div className="row-between" style={{ flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 22, marginBottom: 4 }}>Execution</h1>
            <p className="text-sm muted" style={{ maxWidth: 640, margin: 0 }}>
              Live projection of the real execution foundation: the Execution Supervisor, the durable job
              state, the real project environments and the durable event bus. Every value below is read from
              authoritative backend state — nothing on this page is simulated.
            </p>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <span className={`badge ${live ? 'badge-green' : 'badge-gray'}`}>
              {live ? 'live stream connected' : 'stream reconnecting'}
            </span>
            <button className="btn btn-ghost btn-sm" onClick={() => void reload()} disabled={busy}>
              <I name="refresh" size={14} /> Refresh
            </button>
          </div>
        </div>
        {error && <p className="text-sm mt-12" style={{ color: 'var(--red-600)' }}>{error}</p>}
      </div>

      {!projectId && (
        <div className="card mb-16">
          <p className="text-sm muted" style={{ margin: 0 }}>
            Open a project to see its per-project execution graph and event stream. The supervision, job and
            environment views below are scoped to your account.
          </p>
        </div>
      )}

      <div className="card">
        <div className="tabs">
          {TABS.map((t) => (
            <button key={t.key} className={`tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="mt-16">
          {tab === 'supervision' && <SupervisionTab supervisor={supervisor} jobs={jobs} />}
          {tab === 'jobs' && <JobsTab jobs={jobs} busy={busy} act={act} />}
          {tab === 'environments' && (
            <EnvironmentsTab projectId={projectId} envs={envs} busy={busy} act={act} reload={reload} />
          )}
          {tab === 'graph' && <GraphTab graph={graph} projectId={projectId} />}
          {tab === 'events' && <EventsTab events={events} live={live} projectId={projectId} />}
        </div>
      </div>
    </Shell>
  )
}

function SupervisionTab({ supervisor, jobs }: { supervisor: ApiSupervisorSnapshot | null; jobs: ApiJobRecord[] }) {
  if (!supervisor) return <p className="text-sm muted">The execution supervisor is not reporting.</p>
  const windowMinutes = Math.round(supervisor.progressWindowMs / 60_000)
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="card">
        <h4 className="mb-12">Execution supervisor</h4>
        <div style={{ display: 'grid', gap: 8 }}>
          <Row k="Boot id" v={<span className="mono text-xs">{supervisor.bootId}</span>} />
          <Row k="Last tick" v={supervisor.lastTickAt ? fmtDateTime(supervisor.lastTickAt) : 'No tick recorded yet'} />
          <Row k="Ticks" v={String(supervisor.tickSeq)} />
          <Row
            k="Hard timeout"
            v={`${windowMinutes} minute independent no-meaningful-progress backstop`}
          />
          <Row
            k="Network boundary"
            v={
              supervisor.networkUp === null
                ? 'not yet probed'
                : supervisor.networkUp
                  ? `reachable — ${supervisor.lastProbe?.detail ?? 'probe ok'}`
                  : `UNAVAILABLE — ${supervisor.lastProbe?.detail ?? 'probe failed'}`
            }
          />
        </div>
      </div>
      <div className="card">
        <h4 className="mb-12">Supervised runs ({supervisor.active.length})</h4>
        {supervisor.active.length === 0 ? (
          <p className="text-sm muted" style={{ margin: 0 }}>No active supervised run.</p>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {supervisor.active.map((r) => (
              <div key={r.jobId} className="row-between text-sm" style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--surface-2)' }}>
                <span><span className="mono" style={{ marginRight: 8 }}>{r.jobId}</span>{r.stageKey}</span>
                <span className="row" style={{ gap: 8 }}>
                  <Status status={r.status} />
                  <span className="text-xs muted">idle {Math.round(r.idleMs / 1000)}s</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="card">
        <h4 className="mb-12">Account job ledger ({jobs.length})</h4>
        {jobs.length === 0 ? (
          <p className="text-sm muted" style={{ margin: 0 }}>No job has been enqueued for this account yet.</p>
        ) : (
          <div style={{ display: 'grid', gap: 6 }}>
            {jobs.map((j) => (
              <div key={j.id} className="row-between text-sm" style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--surface-2)' }}>
                <span><span className="mono" style={{ marginRight: 8 }}>{j.id}</span>{j.label}</span>
                <span className="row" style={{ gap: 8 }}><Status status={j.status} /></span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function JobsTab({
  jobs,
  busy,
  act,
}: {
  jobs: ApiJobRecord[]
  busy: boolean
  act: (fn: () => Promise<unknown>) => Promise<void>
}) {
  if (jobs.length === 0) {
    return <p className="text-sm muted">No jobs recorded. Run a lifecycle stage on a project to create one.</p>
  }
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {jobs.map((j) => (
        <div key={j.id} className="card" style={{ padding: 14 }}>
          <div className="row-between" style={{ flexWrap: 'wrap', gap: 8 }}>
            <div>
              <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                <span className="mono text-xs">{j.id}</span>
                <strong>{j.label}</strong>
                <Status status={j.status} />
              </div>
              <div className="text-xs muted mt-4">
                stage <span className="mono">{j.stageKey}</span> · attempts {j.attempts}/{j.maxAttempts} ·
                created {fmtDateTime(j.createdAt)}
                {j.startedAt ? ` · started ${fmtDateTime(j.startedAt)}` : ''}
              </div>
            </div>
            <div className="row" style={{ gap: 6 }}>
              {j.status === 'RUNNING' && (
                <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act(() => executionApi.jobAction(j.id, 'pause'))}>Pause</button>
              )}
              {j.status === 'PAUSED' && (
                <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act(() => executionApi.jobAction(j.id, 'resume'))}>Resume</button>
              )}
              {(j.status === 'COMPLETED' || j.status === 'FAILED' || j.status === 'CANCELLED') && (
                <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act(() => executionApi.jobAction(j.id, 'retry'))}>Retry</button>
              )}
              {j.status !== 'CANCELLED' && j.status !== 'COMPLETED' && (
                <button className="btn btn-outline-green btn-sm" disabled={busy} onClick={() => act(() => executionApi.jobAction(j.id, 'cancel'))}>Cancel</button>
              )}
            </div>
          </div>
          {j.ai && (
            <div className="text-xs muted mt-8">
              bound AI: <span className="mono">{j.ai.providerId}/{j.ai.modelId}</span> · config v{j.ai.configVersion}
            </div>
          )}
          {j.blockReason && <p className="text-sm mt-8" style={{ margin: 0 }}>Blocked: {j.blockReason}</p>}
          {j.waitReason && <p className="text-sm mt-8" style={{ margin: 0 }}>Waiting ({j.waitKind}): {j.waitReason}</p>}
          {j.error && <p className="text-sm mt-8" style={{ margin: 0, color: 'var(--red-600)' }}>{j.error}</p>}
        </div>
      ))}
    </div>
  )
}

function EnvironmentsTab({
  projectId,
  envs,
  busy,
  act,
  reload,
}: {
  projectId?: string
  envs: ApiEnvRecord[]
  busy: boolean
  act: (fn: () => Promise<unknown>) => Promise<void>
  reload: () => Promise<void>
}) {
  const [selected, setSelected] = useState<string>('')
  const [path, setPath] = useState('')
  const [entries, setEntries] = useState<Array<{ name: string; relPath: string; kind: string; size: number }> | null>(null)
  const [file, setFile] = useState<string | null>(null)
  const [command, setCommand] = useState('node -v')
  const [term, setTerm] = useState<{ exitCode: number; stdout: string; stderr: string; durationMs: number } | null>(null)
  const [git, setGit] = useState<{ branch: string; entries: Array<{ path: string; status: string }> } | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)

  const envId = selected !== '' ? selected : envs[0]?.id ?? ''

  const browse = useCallback(
    async (target: string) => {
      if (!envId) return
      try {
        const res = await executionApi.files(envId, target)
        setEntries(res.entries)
        setPath(target)
        setLocalError(null)
      } catch (err) {
        setLocalError(err instanceof Error ? err.message : 'The workspace is not readable.')
      }
    },
    [envId],
  )

  useEffect(() => {
    if (envId) void browse('')
  }, [envId, browse])

  const openFile = useCallback(
    async (relPath: string) => {
      if (!envId) return
      try {
        const res = await executionApi.readFile(envId, relPath)
        setFile(res.content)
        setLocalError(null)
      } catch (err) {
        setLocalError(err instanceof Error ? err.message : 'The file could not be read.')
      }
    },
    [envId],
  )

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {projectId && (
        <div className="row" style={{ gap: 8 }}>
          <button
            className="btn btn-ghost btn-sm"
            disabled={busy}
            onClick={() => act(async () => { await executionApi.createEnvironment(projectId, 'Development workspace'); await reload() })}
          >
            Provision a real workspace
          </button>
        </div>
      )}
      {envs.length === 0 ? (
        <p className="text-sm muted" style={{ margin: 0 }}>
          No execution environment exists yet. Provisioning creates a real workspace through the real
          backend the platform selected (local workspace today; a real Daytona workspace when the Daytona
          CLI is installed and healthy).
        </p>
      ) : (
        <div className="card">
          <h4 className="mb-12">Project execution environments</h4>
          <div style={{ display: 'grid', gap: 8 }}>
            {envs.map((e) => (
              <div key={e.id} className="row-between text-sm" style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--surface-2)' }}>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => setSelected(e.id)}
                  style={{ fontWeight: envId === e.id ? 700 : 400 }}
                >
                  <span className="mono text-xs" style={{ marginRight: 8 }}>{e.id}</span>{e.label}
                </button>
                <span className="row" style={{ gap: 8 }}>
                  <span className="badge badge-gray">{e.adapterKind}</span>
                  <Status status={e.status} />
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {envId && (
        <>
          <div className="card">
            <h4 className="mb-8">Environment health</h4>
            {envs.filter((e) => e.id === envId).map((e) => (
              <div key={e.id} style={{ display: 'grid', gap: 8 }}>
                <Row k="Backend" v={e.adapterKind} />
                <Row k="Status" v={<Status status={e.status} />} />
                <Row k="Workspace" v={e.workspaceRoot ?? '—'} />
                <Row k="Last real health check" v={e.lastHealth ? `${e.lastHealth.detail} (${fmtDateTime(e.lastHealth.checkedAt)})` : 'No health check recorded'} />
                <div className="row" style={{ gap: 6, marginTop: 4 }}>
                  <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act(() => executionApi.envAction(e.id, 'verify'))}>Re-verify</button>
                  {e.status === 'READY' && (
                    <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act(() => executionApi.envAction(e.id, 'pause'))}>Pause</button>
                  )}
                  {e.status === 'PAUSED' && (
                    <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act(() => executionApi.envAction(e.id, 'resume'))}>Resume</button>
                  )}
                  {e.status !== 'DESTROYED' && (
                    <button className="btn btn-outline-green btn-sm" disabled={busy} onClick={() => act(() => executionApi.envAction(e.id, 'destroy'))}>Destroy</button>
                  )}
                </div>
                <p className="text-xs muted" style={{ margin: '6px 0 0' }}>
                  Destroying an environment removes the real workspace only. Durable evidence, provenance and
                  certification history are never destroyed with it.
                </p>
              </div>
            ))}
          </div>

          <div className="card">
            <h4 className="mb-12">Real project files</h4>
            <div className="row" style={{ gap: 8, marginBottom: 10 }}>
              <span className="text-xs mono muted">/{path}</span>
              {path !== '' && (
                <button className="btn btn-ghost btn-sm" onClick={() => void browse(path.split('/').slice(0, -1).join('/'))}>Up</button>
              )}
            </div>
            {localError && <p className="text-sm" style={{ color: 'var(--red-600)' }}>{localError}</p>}
            {!entries ? (
              <p className="text-sm muted">Loading the real workspace listing…</p>
            ) : entries.length === 0 ? (
              <p className="text-sm muted">This directory is empty.</p>
            ) : (
              <div style={{ display: 'grid', gap: 4 }}>
                {entries.map((entry) => (
                  <div key={entry.relPath} className="row-between text-sm">
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => (entry.kind === 'dir' ? void browse(entry.relPath) : void openFile(entry.relPath))}                    >
                      {entry.kind === 'dir' ? '▸' : '·'} {entry.name}
                    </button>
                    <span className="text-xs muted">{entry.kind === 'dir' ? 'dir' : `${entry.size} B`}</span>
                  </div>
                ))}
              </div>
            )}
            {file !== null && (
              <pre className="mono text-xs mt-12" style={{ whiteSpace: 'pre-wrap', maxHeight: 260, overflow: 'auto' }}>{file}</pre>
            )}
          </div>

          <div className="card">
            <h4 className="mb-8">Real terminal</h4>
            <div className="row" style={{ gap: 8 }}>
              <input
                className="input"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                aria-label="Command"
                style={{ flex: 1 }}
              />
              <button
                className="btn btn-ghost btn-sm"
                disabled={busy}
                onClick={() => act(async () => { setTerm(await executionApi.terminal(envId, command)); setGit(await executionApi.gitStatus(envId)) })}
              >
                Run
              </button>
            </div>
            {term && (
              <pre className="mono text-xs mt-12" style={{ whiteSpace: 'pre-wrap', maxHeight: 220, overflow: 'auto' }}>
                {`exit ${term.exitCode} in ${term.durationMs}ms\n${term.stdout}${term.stderr ? `\n[stderr] ${term.stderr}` : ''}`}
              </pre>
            )}
            {git && (
              <div className="text-xs muted mt-8">
                git branch <span className="mono">{git.branch}</span> · {git.entries.length} change(s)
              </div>
            )}
          </div>
        </>
      )}

      {busy && <p className="text-sm muted">Working against the real execution environment…</p>}
    </div>
  )
}

function GraphTab({ graph, projectId }: { graph: ApiExecutionGraph | null; projectId?: string }) {
  if (!projectId) return <p className="text-sm muted">Open a project to inspect its execution graph.</p>
  if (!graph) return <p className="text-sm muted">The execution graph is not available yet.</p>
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="card">
        <h4 className="mb-12">Job status counts</h4>
        <div style={{ display: 'grid', gap: 6 }}>
          {Object.entries(graph.statusCounts).map(([status, count]) => (
            <Row key={status} k={status} v={String(count)} />
          ))}
          <Row k="Completed / total" v={`${graph.completedCount} / ${graph.totalCount}`} />
        </div>
      </div>
      {graph.blockages.length > 0 && (
        <div className="card">
          <h4 className="mb-12">Current blockages</h4>
          <div style={{ display: 'grid', gap: 6 }}>
            {graph.blockages.map((b) => (
              <div key={b.id} className="text-sm" style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--surface-2)' }}>
                <span className="mono text-xs" style={{ marginRight: 8 }}>{b.id}</span>{b.reason}
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="card">
        <h4 className="mb-12">Execution nodes ({graph.nodes.length})</h4>
        {graph.nodes.length === 0 ? (
          <p className="text-sm muted" style={{ margin: 0 }}>No execution node has been recorded for this project yet.</p>
        ) : (
          <div style={{ display: 'grid', gap: 6 }}>
            {graph.nodes.map((n) => (
              <div key={n.id} className="row-between text-sm" style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--surface-2)' }}>
                <span><span className="mono text-xs" style={{ marginRight: 8 }}>{n.id}</span>{n.label}</span>
                <span className="row" style={{ gap: 8 }}>
                  {n.ai ? <span className="text-xs muted mono">{n.ai.providerId}/{n.ai.modelId}</span> : null}
                  <Status status={n.status} />
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="card">
        <h4 className="mb-12">Dependency edges ({graph.edges.length})</h4>
        {graph.edges.length === 0 ? (
          <p className="text-sm muted" style={{ margin: 0 }}>No dependency edge recorded.</p>
        ) : (
          <div style={{ display: 'grid', gap: 4 }}>
            {graph.edges.map((e, i) => (
              <div key={`${e.from}-${e.to}-${i}`} className="text-xs mono muted">
                {e.from} → {e.to}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function EventsTab({ events, live, projectId }: { events: ApiExecutionEvent[]; live: boolean; projectId?: string }) {
  return (
    <div className="card">
      <div className="row-between mb-12">
        <h4 style={{ margin: 0 }}>Durable event stream</h4>
        <span className={`badge ${live ? 'badge-green' : 'badge-gray'}`}>{live ? 'live' : 'offline'}</span>
      </div>
      {!projectId ? (
        <p className="text-sm muted" style={{ margin: 0 }}>Open a project to stream its execution events.</p>
      ) : events.length === 0 ? (
        <p className="text-sm muted" style={{ margin: 0 }}>
          No event received yet. Events appear the moment a job, environment or supervisor actually acts.
        </p>
      ) : (
        <div style={{ display: 'grid', gap: 4, maxHeight: 420, overflow: 'auto' }}>
          {events
            .slice()
            .reverse()
            .map((e) => (
              <div key={`${e.id}-${e.seq}`} className="text-xs" style={{ padding: '6px 10px', borderRadius: 6, background: 'var(--surface-2)' }}>
                <span className="mono muted" style={{ marginRight: 8 }}>#{e.seq}</span>
                <span className="mono">{e.type}</span>
                {e.jobId ? <span className="muted"> · {e.jobId}</span> : null}
                <span className="muted"> · {fmtDateTime(e.ts)}</span>
                {e.payload ? <div className="mono muted" style={{ marginTop: 2 }}>{JSON.stringify(e.payload).slice(0, 220)}</div> : null}
              </div>
            ))}
        </div>
      )}
    </div>
  )
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="row-between text-sm">
      <span className="muted">{k}</span>
      <span>{v}</span>
    </div>
  )
}
