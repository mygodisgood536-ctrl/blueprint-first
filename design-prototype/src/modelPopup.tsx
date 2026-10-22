import React, { useState, useEffect } from 'react'
import { api, ApiProjectAiConfig, ApiProviderDescriptor, ApiModelRow, ApiCatalogueStatus } from './api'
import { I } from './icons2'
import { SecretField } from './components/SecretField'

/* § 3.3 EXACT AI MODEL POPUP — NON-NEGOTIABLE UI SPECIFICATION.
   This component is the project's single AI MODEL control and the single
   AI MODEL popup. Its structure matches the authoritative drawing exactly:
   title, FREE MODELS list, API PROVIDER section (Provider, API Key, Model
   with the two exact copy lines) and the Verify + Done actions. Provider
   and model data are populated from the real OpenCode-backed catalogue, and
   Verify runs a real connection test through the platform credential and
   execution path. No second AI model selector may exist elsewhere. */

const FREE_CATS = ['free_no_api_key', 'free_api_key_required', 'free_oauth', 'local']

/* § V.5 + §"PROJECT-WIDE AI PROVIDER AND MODEL" — the catalogue is PUSHED BY
   THE PROVIDER.

   There is deliberately NO approved list of model names in this file. The
   architecture states that "their presence in the approved drawing does not
   authorize hard-coding a permanent catalog" and that "provider and model
   availability must be derived from the real integrated OpenCode state". A
   model shown today may be withdrawn tomorrow, and a model that is free today
   may be priced tomorrow - so the list, the free/paid classification and the
   availability of every entry come from the live catalogue on each load.

   A model is selectable only when the catalogue currently offers it; one the
   provider has withdrawn is shown as unavailable rather than silently dropped
   or, worse, presented as available. */

/* The project page exposes the project's AI MODEL control. Clicking it opens
   the exact popup; Done returns to this compact AI MODEL state. */
export function AiModelControl({
  value,
  onChange,
}: {
  value: ApiProjectAiConfig | null
  onChange: (v: ApiProjectAiConfig | null) => void | Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [providers, setProviders] = useState<ApiProviderDescriptor[]>([])

  useEffect(() => {
    if (!open && !value) return
    let alive = true
    api.providers
      .list()
      .then((res) => { if (alive) setProviders(res.providers) })
      .catch(() => {})
    return () => { alive = false }
  }, [open, value])

  const providerName = value ? providers.find((p) => p.providerId === value.providerId)?.name ?? null : null

  const clear = async (evt: React.MouseEvent) => {
    evt.stopPropagation()
    await onChange(null)
  }

  return (
    <>
      <button
        className="aim-chip"
        onClick={() => setOpen(true)}
        role="button"
        aria-label={value ? `AI model: ${providerName || value.providerId} ${value.modelId}` : 'AI model not configured'}
      >
        <I name="cpu" size={15} />
        <span className="cp-label">
          <strong>AI MODEL</strong>
          {value ? (
            <>
              <span className="aim-sep">·</span>
              {providerName || value.providerId}
              <span className="aim-sep">·</span>
              {value.modelId}
            </>
          ) : (
            <>
              <span className="aim-sep">·</span>
              not configured
            </>
          )}
        </span>
        {value ? (
          <>
            <span className="badge badge-green" style={{ fontSize: 10 }}>Verified</span>
            <span className="aim-clear" role="button" aria-label="Remove AI model" onClick={clear}>×</span>
          </>
        ) : (
          <I name="chevronDown" size={14} />
        )}
      </button>

      {open && (
        <AiConfigurationPanel
          value={value}
          onClose={() => setOpen(false)}
          onChange={async (v) => {
            await onChange(v)
            setOpen(false)
          }}
        />
      )}
    </>
  )
}

/* The AI CONFIGURATION panel — the single provider/model control.
   It is rendered in two places and they are the SAME control, not two
   competing selectors: as the exact AI MODEL popup, and inline in the task
   composer's side panel so the user can see and change the model that will
   execute their instruction without leaving the composer. */
export function AiConfigurationPanel({
  value,
  onChange,
  onClose,
  variant = 'popup',
}: {
  value: ApiProjectAiConfig | null
  onChange: (v: ApiProjectAiConfig) => Promise<void> | void
  /** Optional: closes the surrounding popup after a successful save. */
  onClose?: () => void
  /** 'popup' is the modal shell; 'panel' is the inline composer panel. */
  variant?: 'popup' | 'panel'
}) {
  const [providers, setProviders] = useState<ApiProviderDescriptor[]>([])
  const [provider, setProvider] = useState(value?.providerId ?? '')
  const [keyValue, setKeyValue] = useState('')
  const [model, setModel] = useState(value?.modelId ?? '')
  const [models, setModels] = useState<ApiModelRow[] | null>(null)
  const [freeModels, setFreeModels] = useState<ApiModelRow[]>([])
  const [freeQuery, setFreeQuery] = useState('')
  const [providerQuery, setProviderQuery] = useState('')
  const [modelQuery, setModelQuery] = useState('')
  const [catalogue, setCatalogue] = useState<ApiCatalogueStatus | null>(null)
  const [loadErr, setLoadErr] = useState('')
  const [freeErr, setFreeErr] = useState('')
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)
  const [verified, setVerified] = useState(false)
  const [verifyBusy, setVerifyBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [credentialId, setCredentialId] = useState<string | undefined>(value?.credentialId)

  useEffect(() => {
    let alive = true
    api.providers
      .list()
      .then((res) => {
        if (!alive) return
        setProviders(res.providers)
        const cur = res.providers.find((p) => p.providerId === provider) ?? null
        if (cur) {
          setVerified(cur.connectionVerified)
          if (cur.connectionVerified) setStatus({ ok: true, text: 'Connection verified.' })
        }
      })
      .catch((err) => {
        if (alive) setLoadErr(err instanceof Error ? err.message : 'The provider catalogue is unavailable.')
      })
    api.models
      .list({ accessCategory: FREE_CATS, availableOnly: true })
      .then((res) => { if (alive) { setFreeModels(res.models); setCatalogue(res.catalogue ?? null) } })
      .catch(() => { if (alive) setFreeErr('Free model availability is unavailable right now — the list refreshes automatically.') })
    return () => { alive = false }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // Escape closes the modal shell. The inline panel has no shell to close, so
    // the listener is only bound when there is something to close.
    if (onClose === undefined) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const current = providers.find((p) => p.providerId === provider) ?? null

  /*
   * The free/paid split comes from the PUBLISHED PRICING the provider
   * returned, never from the model's name. A model whose input and output
   * price are both zero is free; anything else - including a model whose price
   * is unknown - is paid. A model is only ever presented as free when the
   * catalogue says so.
   */
  const freeGroups = (() => {
    const term = freeQuery.trim().toLowerCase()
    const matching = term.length === 0
      ? freeModels
      : freeModels.filter((r) =>
          `${r.name} ${r.modelId} ${r.providerName}`.toLowerCase().includes(term),
        )
    const isFree = (r: ApiModelRow): boolean =>
      r.inputCostPer1M !== null && r.inputCostPer1M === 0 &&
      r.outputCostPer1M !== null && r.outputCostPer1M === 0
    const free = matching.filter(isFree)
    const paid = matching.filter((r) => !isFree(r))
    return { free, paid }
  })()

  /* The provider selector lists the providers the platform can genuinely
     offer, in the order the provider catalogue supplied them. */
  const visibleProviders = (() => {
    const term = providerQuery.trim().toLowerCase()
    if (term.length === 0) return providers
    return providers.filter((p) =>
      `${p.name} ${p.providerId}`.toLowerCase().includes(term),
    )
  })()

  useEffect(() => {
    if (!provider) { setModels(null); return }
    let alive = true
    api.models
      .list({ providerId: provider })
      .then((res) => { if (alive) setModels(res.models) })
      .catch(() => { if (alive) setModels([]) })
    return () => { alive = false }
  }, [provider])

  const selectProvider = (id: string) => {
    setProvider(id)
    setVerified(false)
    setStatus(null)
    setCredentialId(value && value.providerId === id ? value.credentialId : undefined)
    setModel(value && value.providerId === id ? value.modelId : '')
  }

  const verify = async () => {
    if (!current || verifyBusy) return
    if (current.wired === false) {
      setStatus({ ok: false, text: `${current.name} is listed in the catalogue but no execution adapter is wired in this build — verification is unavailable.` })
      return
    }
    setVerifyBusy(true)
    setStatus(null)
    try {
      if (keyValue.trim()) {
        const cred = await api.credentials.add(current.providerId, keyValue.trim())
        setKeyValue('')
        if (cred.verified) setCredentialId(cred.id)
      } else if (current.authMethod !== 'none' && !current.configured) {
        setStatus({ ok: false, text: 'Enter an API key first — an empty field cannot be verified.' })
        setVerified(false)
        return
      }
      const res = await api.providers.verify(current.providerId)
      if (res.success) {
        setVerified(true)
        setStatus({ ok: true, text: `Connection verified (${res.modelsAvailable ?? 0} model(s) available).` })
        if (!credentialId) {
          try {
            const creds = await api.credentials.list()
            const cred = creds.credentials.find((c) => c.providerId === current.providerId && c.verified)
            if (cred) setCredentialId(cred.id)
          } catch { /* credentialId stays unset */ }
        }
      } else {
        setVerified(false)
        setCredentialId(undefined)
        setStatus({ ok: false, text: res.errorMessage || 'Verification failed — the connection is not verified.' })
      }
    } catch (err) {
      setVerified(false)
      setStatus({ ok: false, text: err instanceof Error ? err.message : 'Verification failed.' })
    } finally {
      setVerifyBusy(false)
    }
  }

  const done = async () => {
    if (!current || !verified || !model || saving) return
    setSaving(true)
    setStatus(null)
    try {
      await onChange({ providerId: current.providerId, modelId: model, credentialId })
      onClose?.()
    } catch (err) {
      setStatus({ ok: false, text: err instanceof Error ? err.message : 'The AI model configuration could not be saved.' })
    } finally {
      setSaving(false)
    }
  }

  const body = (
    <>
      {/* FREE MODELS - the live, provider-pushed list. Free entries first,
          then paid entries, clearly separated. Nothing is hard-coded. */}
      <div className="aim-section">
        <div className="aim-section-title">FREE MODELS</div>
        {freeErr ? (
          <div className="aim-free-empty">{freeErr}</div>
        ) : (
          <>
            <div className="aim-field">
              <input
                type="search"
                className="aim-search"
                placeholder="Search free models…"
                    aria-label="Search free models"
                    value={freeQuery}
                    onChange={(e) => setFreeQuery(e.target.value)}
                    disabled={verifyBusy || saving}
                    data-testid="model-popup-free-search"
                  />
                </div>
                {catalogue && catalogue.expired && (
                  <div className="aim-status err" data-testid="model-popup-catalogue-stale">
                    The provider catalogue could not be refreshed
                    {catalogue.detail ? `: ${catalogue.detail}` : ''}. The list below is the last one received
                    {catalogue.syncedAt ? ` (${new Date(catalogue.syncedAt).toLocaleString()})` : ''} and may be out of date.
                  </div>
                )}
                {freeGroups.free.length === 0 && freeGroups.paid.length === 0 ? (
                  <div className="aim-free-empty">
                    {freeQuery.trim().length > 0
                      ? 'No model in the live catalogue matches that search.'
                      : 'The integrated catalogue currently offers no free model.'}
                  </div>
                ) : (
                  <>
                    {freeGroups.free.length > 0 && (
                      <>
                        <div className="aim-free-group-title" data-testid="model-popup-free-group">
                          Free — no additional provider key
                        </div>
                        <ul className="aim-free-list" role="listbox" aria-label="Free models">
                          {freeGroups.free.map((row) => {
                            const selected = row.providerId === provider && row.modelId === model
                            return (
                              <li key={`${row.providerId}:${row.modelId}`} role="option" aria-selected={selected}>
                                <button
                                  type="button"
                                  className={`aim-free-row${selected ? ' is-selected' : ''}`}
                                  disabled={verifyBusy || saving}
                                  title={`Use ${row.name}`}
                                  onClick={() => {
                                    setProvider(row.providerId)
                                    setModel(row.modelId)
                                    setVerified(false)
                                    setStatus(null)
                                  }}
                                >
                                  <span className="aim-free-name">{row.name}</span>
                                  <span className="aim-free-state">
                                    {selected ? 'selected' : row.available ? 'available' : 'not offered'}
                                  </span>
                                </button>
                              </li>
                            )
                          })}
                        </ul>
                      </>
                    )}
                    {freeGroups.paid.length > 0 && (
                      <>
                        <div className="aim-free-group-title" data-testid="model-popup-paid-group">
                          Paid — requires credits
                        </div>
                        <ul className="aim-free-list" role="listbox" aria-label="Paid models">
                          {freeGroups.paid.map((row) => {
                            const selected = row.providerId === provider && row.modelId === model
                            return (
                              <li key={`${row.providerId}:${row.modelId}`} role="option" aria-selected={selected}>
                                <button
                                  type="button"
                                  className={`aim-free-row${selected ? ' is-selected' : ''}`}
                                  disabled={verifyBusy || saving}
                                  title={`Use ${row.name}`}
                                  onClick={() => {
                                    setProvider(row.providerId)
                                    setModel(row.modelId)
                                    setVerified(false)
                                    setStatus(null)
                                  }}
                                >
                                  <span className="aim-free-name">{row.name}</span>
                                  <span className="aim-free-state">
                                    {selected ? 'selected' : row.available ? 'available' : 'not offered'}
                                  </span>
                                </button>
                              </li>
                            )
                          })}
                        </ul>
                      </>
                    )}
                  </>
                )}
              </>
            )}
          </div>

          <div className="aim-divider" />

          {/* API PROVIDER */}
          <div className="aim-section">
            <div className="aim-section-title">API PROVIDER</div>

            <label className="aim-field-label" htmlFor="aim-provider">Provider</label>
            <div className="aim-field">
              <input
                type="search"
                className="aim-search"
                placeholder="Search providers…"
                aria-label="Search providers"
                value={providerQuery}
                onChange={(e) => setProviderQuery(e.target.value)}
                disabled={verifyBusy || saving}
                data-testid="model-popup-provider-search"
              />
              <select
                id="aim-provider"
                value={provider}
                onChange={(e) => selectProvider(e.target.value)}
                disabled={verifyBusy || saving}
                data-testid="model-popup-provider"
              >
                <option value="">Select API Provider</option>
                {visibleProviders.map((p) => <option key={p.providerId} value={p.providerId}>{p.name}</option>)}
              </select>
            </div>

            {/* The API key field appears ONLY when the selected provider really
                requires one. A keyless provider must not be shown a disabled or
                misleading key field. */}
            {current !== null && current.authMethod !== 'none' && (
              <>
                <label className="aim-field-label" htmlFor="aim-key">API Key</label>
                <div className="aim-field">
                  <SecretField
                    id="aim-key"
                    value={keyValue}
                    onChange={setKeyValue}
                    placeholder="Paste your provider API key"
                    disabled={verifyBusy || saving}
                    data-testid="model-popup-api-key"
                  />
                </div>
                <p className="aim-copy">This key is stored locally and only used to make API requests from this application.</p>
              </>
            )}

            <label className="aim-field-label" htmlFor="aim-model">Model</label>
            <div className="aim-field">
              <input
                type="search"
                className="aim-search"
                placeholder="Search models…"
                aria-label="Search models"
                value={modelQuery}
                onChange={(e) => setModelQuery(e.target.value)}
                disabled={!current || verifyBusy || saving}
                data-testid="model-popup-model-search"
              />
              <select
                id="aim-model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                disabled={!current || verifyBusy || saving}
                data-testid="model-popup-model"
              >
                <option value="">Select Model</option>
                {((models ?? []).filter((m) => {
                  const term = modelQuery.trim().toLowerCase()
                  return term.length === 0 || `${m.name} ${m.modelId}`.toLowerCase().includes(term)
                })).map((m) => <option key={m.modelId} value={m.modelId}>{m.name}</option>)}
              </select>
              {model && (
                <span className="aim-clear" role="button" aria-label="Clear model" onClick={() => setModel('')}>×</span>
              )}
            </div>
            <p className="aim-copy">The application automatically fetches the latest available models from the selected provider.</p>

            {/* Selecting a provider with no models must never present an
                arbitrary list: the user is told to choose first. */}
            {current !== null && (models ?? []).length === 0 && (
              <div className="aim-status err" data-testid="model-popup-no-models">
                {current.name} currently offers no model through the integrated catalogue.
                {current.wired === false ? ' No execution adapter is wired for it in this build.' : ''}
              </div>
            )}

            {loadErr && <div className="aim-status err">{loadErr}</div>}
            {status && <div className={`aim-status ${status.ok ? 'ok' : 'err'}`}>{status.text}</div>}
          </div>
    </>
  )

  const actions = (
    <>
      <button className="btn btn-primary" onClick={verify} disabled={!current || verifyBusy || saving}>
        {verifyBusy ? <><span className="spin" /> Verifying…</> : 'Verify'}
      </button>
      <button className="btn btn-primary" onClick={done} disabled={!verified || !model || saving}>
        {saving ? <><span className="spin" /> Saving…</> : 'Done'}
      </button>
    </>
  )

  if (variant === 'panel') {
    return (
      <div className="aim-panel" data-testid="ai-configuration-panel">
        <div className="aim-panel-header">
          <h3 className="aim-popup-title">AI CONFIGURATION</h3>
        </div>
        <div className="aim-divider" />
        <div className="aim-scroll">{body}</div>
        <div className="aim-divider" />
        <div className="aim-footer">{actions}</div>
      </div>
    )
  }

  return (
    <div className="aim-overlay" onClick={onClose}>
      <div
        className="aim-popup"
        role="dialog"
        aria-modal="true"
        aria-label="AI model"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="aim-popup-header">
          <h3 className="aim-popup-title">AI MODEL</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close"><I name="close" size={14} /></button>
        </div>
        <div className="aim-divider" />
        <div className="aim-scroll">{body}</div>
        <div className="aim-divider" />
        <div className="aim-footer">{actions}</div>
      </div>
    </div>
  )
}

