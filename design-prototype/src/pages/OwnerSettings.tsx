import React, { useState, useEffect, useCallback } from 'react'
import { Shell } from '../shell'
import { ownerApi, ApiDaytonaState } from '../api'
import { I } from '../icons2'
import { SecretField } from '../components/SecretField'

/**
 * PLATFORM CONFIGURATION (private administration area).
 *
 * Daytona is platform infrastructure: it is configured once, here, and then used
 * by every project. The API key is write-only — it is submitted once, verified by
 * the backend against the REAL Daytona API and the REAL Daytona CLI, and never
 * returned to this page or to any other client.
 *
 * "Connected" is only ever shown when the backend genuinely authenticated. An
 * invalid key shows the real failure and never activates.
 *
 * ACCESS: every /api/owner/* route is refused by the backend with 403 for any
 * other account, so hiding the navigation entry is presentation only. The server
 * is the security boundary.
 */

const STATUS_BADGE: Record<string, { text: string; cls: string }> = {
  unconfigured: { text: 'Not configured', cls: 'badge-gray' },
  verifying: { text: 'Verifying…', cls: 'badge-yellow' },
  connected: { text: 'Connected', cls: 'badge-green' },
  failed: { text: 'Connection failed', cls: 'badge-red' },
}

export function OwnerSettings({ isOwner }: { isOwner: boolean }) {
  const [state, setState] = useState<ApiDaytonaState | null>(null)
  const [activeBackend, setActiveBackend] = useState<string>('')
  const [links, setLinks] = useState<{ signupUrl?: string; docsUrl?: string }>({})
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(() => {
    if (!isOwner) return
    ownerApi
      .daytona()
      .then((res) => {
        setState(res.daytona)
        setActiveBackend(res.activeBackend)
        setLinks({ signupUrl: res.signupUrl, docsUrl: res.docsUrl })
        setError(null)
      })
      .catch((e: Error) => setError(e.message))
  }, [isOwner])

  useEffect(() => {
    load()
  }, [load])

  const submit = async () => {
    if (apiKey.trim().length === 0) {
      setError('Enter the Daytona API key first.')
      return
    }
    setBusy(true)
    setError(null)
    setNotice(null)
    // The key is write-only: it is sent once and then cleared from this form.
    const key = apiKey
    setApiKey('')
    try {
      const res = await ownerApi.saveDaytona(key)
      setState(res.daytona)
      setActiveBackend(res.activeBackend)
      if (res.daytonaConfigured) {
        setNotice('Daytona verified. It is now the active execution backend for new environments.')
      } else {
        setNotice(null)
        setError(res.daytona.detail)
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'The Daytona credential could not be verified.'
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  const clear = async () => {
    setBusy(true)
    try {
      const res = await ownerApi.clearDaytona()
      setState(res.daytona)
      setActiveBackend(res.activeBackend)
      setNotice('The Daytona configuration was removed.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The configuration could not be removed.')
    } finally {
      setBusy(false)
    }
  }

  if (!isOwner) {
    return (
      <Shell breadcrumb={[{ label: 'Settings' }]}>
        <div className="card">
          <h1>Not available</h1>
          <p className="text-sm muted" style={{ marginBottom: 0 }}>
            This area is not available for your account.
          </p>
        </div>
      </Shell>
    )
  }

  const badge = state ? (STATUS_BADGE[state.status] ?? { text: state.status, cls: 'badge-gray' }) : null

  return (
    <Shell breadcrumb={[{ label: 'Settings' }, { label: 'Infrastructure' }]}>
      <div className="page-head">
        <div>
          <h1>Infrastructure</h1>
          <p className="subtitle">
            Platform-level execution infrastructure. Configuring it here applies it to every project, with no
            rebuild, restart, or per-project key entry.
          </p>
        </div>
        <button className="btn btn-ghost" onClick={load} disabled={busy}>
          <I name="refresh" /> Refresh
        </button>
      </div>

      <div className="card mb-16">
        <div className="row-between" style={{ flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h4 style={{ margin: 0 }}>Project execution environment</h4>
            <p className="text-sm muted" style={{ margin: '6px 0 0', maxWidth: 720 }}>
              Daytona runs project work in real, isolated sandboxes. Connect an account once and it becomes the
              active execution backend for new environments.
            </p>
          </div>
          {badge ? <span className={`badge ${badge.cls}`}>{badge.text}</span> : null}
        </div>

        <div className="mt-16" style={{ display: 'grid', gap: 8 }}>
          <Row k="Connection state" v={state?.status ?? 'loading'} />
          <Row k="Active environment backend" v={activeBackend || '—'} />
          <Row k="Daytona CLI" v={state?.cliVersion ?? (state?.status === 'connected' ? 'verified' : 'not verified')} />
          <Row k="Daytona account" v={state?.accountLabel ?? '—'} />
          <Row k="Verified at" v={state?.verifiedAt ?? '—'} />
          {state?.capabilities && state.capabilities.length > 0 && (
            <Row k="Verified capabilities" v={state.capabilities.join(' · ')} />
          )}
        </div>

        {state?.detail ? (
          <p
            className="text-sm mt-12"
            style={{ color: state.status === 'connected' ? 'var(--green-600)' : 'var(--red-600)' }}
          >
            {state.detail}
          </p>
        ) : null}
        {notice ? (
          <p className="text-sm mt-12" style={{ color: 'var(--green-600)' }}>
            {notice}
          </p>
        ) : null}
        {error ? (
          <p className="text-sm mt-12" style={{ color: 'var(--red-600)' }}>
            {error}
          </p>
        ) : null}

        <div className="divider" />

        <h4 className="mb-8">Connect a Daytona account</h4>
        <p className="text-sm muted mb-12">
          {state?.status === 'connected'
            ? 'Daytona is connected. Entering a new key replaces it; it is verified again before it is activated.'
            : 'Create a Daytona account, generate an API key, and paste it here. It is verified against the real Daytona API and the real Daytona CLI before it is activated.'}
        </p>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {links.signupUrl ? (
            <a className="btn btn-ghost btn-sm" href={links.signupUrl} target="_blank" rel="noreferrer">
              Get a Daytona account
            </a>
          ) : null}
          {links.docsUrl ? (
            <a className="btn btn-ghost btn-sm" href={links.docsUrl} target="_blank" rel="noreferrer">
              Daytona docs
            </a>
          ) : null}
        </div>

        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'stretch' }}>
          <div style={{ flex: 1, minWidth: 280 }}>
            <SecretField
              value={apiKey}
              onChange={setApiKey}
              placeholder="Daytona API key (dtn_…) — stored once, never shown again"
              disabled={busy}
              data-testid="daytona-api-key"
            />
          </div>
          <button className="btn btn-primary" onClick={submit} disabled={busy || apiKey.trim().length === 0}>
            {busy ? (
              <>
                <span className="spin" /> Verifying…
              </>
            ) : (
              'Verify & connect'
            )}
          </button>
          {state?.status === 'connected' ? (
            <button className="btn btn-outline-green" onClick={clear} disabled={busy}>
              Disconnect
            </button>
          ) : null}
        </div>
        <p className="text-xs muted mt-8">
          The key is held in the platform credential boundary. It is never returned to this page, never placed
          in the browser URL, never logged, and never included in evidence records or job output.
        </p>
      </div>
    </Shell>
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
