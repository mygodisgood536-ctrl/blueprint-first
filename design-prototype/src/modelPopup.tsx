import React, { useState, useEffect } from 'react'
import { api, ApiProjectAiConfig, ApiProviderDescriptor, ApiModelRow } from './api'
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

/* § V.5 APPROVED FREE-MODELS CONTRACT (Decision D6).
   The approved set is fixed and ordered. Availability is NOT hard-coded: an
   entry is selectable only when the live, OpenCode-backed catalogue actually
   offers it right now, and an entry the catalogue does not offer is shown as
   unavailable rather than being silently dropped or, worse, presented as
   available. The catalogue may offer additional genuinely-free models; those are
   listed separately so a user is never blocked by a catalogue that has moved. */
export const APPROVED_FREE_MODELS: readonly string[] = [
  'Space Bunny Free',
  'MiMo-V2.6-Flash Free',
  'Muse Spark 1.3 Free',
  'Ling 3.0 Flash Fin Free',
  'Nemotron 3.5 Lightning Free',
  'Muse Spark 1.2 Free',
  'Nemotron 3 Ultra Free',
  'Big Pickle',
]

function normalizeModelName(name: string): string {
  return name.trim().toLowerCase().replace(/[\s_]+/g, '-')
}

/** Matches an approved label to a live catalogue row, tolerating provider prefixes. */
function matchApproved(label: string, rows: readonly ApiModelRow[]): ApiModelRow | null {
  const target = normalizeModelName(label)
  const exact = rows.find((r) => normalizeModelName(r.name) === target)
  if (exact) return exact
  const suffixed = rows.find((r) => normalizeModelName(r.name).endsWith(`/${target}`))
  return suffixed ?? null
}

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
        <AiModelPopup
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

/* The exact AI MODEL popup — structure matches the authoritative drawing. */
function AiModelPopup({
  value,
  onClose,
  onChange,
}: {
  value: ApiProjectAiConfig | null
  onClose: () => void
  onChange: (v: ApiProjectAiConfig) => Promise<void>
}) {
  const [providers, setProviders] = useState<ApiProviderDescriptor[]>([])
  const [provider, setProvider] = useState(value?.providerId ?? '')
  const [keyValue, setKeyValue] = useState('')
  const [model, setModel] = useState(value?.modelId ?? '')
  const [models, setModels] = useState<ApiModelRow[] | null>(null)
  const [freeModels, setFreeModels] = useState<ApiModelRow[]>([])
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
      .then((res) => { if (alive) setFreeModels(res.models) })
      .catch(() => { if (alive) setFreeErr('Free model availability is unavailable right now — the list refreshes automatically.') })
    return () => { alive = false }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const current = providers.find((p) => p.providerId === provider) ?? null

  // Catalogue entries that are genuinely free but are not part of the approved
  // set. They are surfaced separately so a user is never blocked by a catalogue
  // that has moved on, without ever being presented as part of the approved set.
  const extraFree = freeModels.filter(
    (row) => APPROVED_FREE_MODELS.every((label) => matchApproved(label, [row]) === null),
  )

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
      onClose()
    } catch (err) {
      setStatus({ ok: false, text: err instanceof Error ? err.message : 'The AI model configuration could not be saved.' })
    } finally {
      setSaving(false)
    }
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

        <div className="aim-scroll">
          {/* FREE MODELS - the approved set, gated on live catalogue availability. */}
          <div className="aim-section">
            <div className="aim-section-title">FREE MODELS</div>
            {freeErr ? (
              <div className="aim-free-empty">{freeErr}</div>
            ) : (
              <>
                <ul className="aim-free-list" role="listbox" aria-label="Approved free models">
                  {APPROVED_FREE_MODELS.map((label) => {
                    const row = matchApproved(label, freeModels)
                    const selected = row !== null && row.providerId === provider && row.modelId === model
                    return (
                      <li key={label} role="option" aria-selected={selected}>
                        <button
                          type="button"
                          className={`aim-free-row${selected ? ' is-selected' : ''}${row === null ? ' is-unavailable' : ''}`}
                          disabled={row === null || verifyBusy || saving}
                          title={
                            row === null
                              ? 'The integrated catalogue does not offer this model right now.'
                              : `Use ${row.name}`
                          }
                          onClick={() => {
                            if (row === null) return
                            setProvider(row.providerId)
                            setModel(row.modelId)
                            setVerified(false)
                            setStatus(null)
                          }}
                        >
                          <span className="aim-free-name">{label}</span>
                          <span className="aim-free-state">
                            {row === null ? 'not offered' : selected ? 'selected' : 'available'}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
                {extraFree.length > 0 && (
                  <div className="aim-free-extra">
                    <div className="aim-free-extra-title">Also available from the integrated catalogue</div>
                    {extraFree.map((m) => (
                      <button
                        key={`${m.providerId}:${m.modelId}`}
                        type="button"
                        className={`aim-free-row${m.providerId === provider && m.modelId === model ? ' is-selected' : ''}`}
                        disabled={verifyBusy || saving}
                        onClick={() => {
                          setProvider(m.providerId)
                          setModel(m.modelId)
                          setVerified(false)
                          setStatus(null)
                        }}
                      >
                        <span className="aim-free-name">{m.name}</span>
                        <span className="aim-free-state">available</span>
                      </button>
                    ))}
                  </div>
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
              <select
                id="aim-provider"
                value={provider}
                onChange={(e) => selectProvider(e.target.value)}
                disabled={verifyBusy || saving}
              >
                <option value="">Select API Provider</option>
                {providers.map((p) => <option key={p.providerId} value={p.providerId}>{p.name}</option>)}
              </select>
            </div>

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

            <label className="aim-field-label" htmlFor="aim-model">Model</label>
            <div className="aim-field">
              <select
                id="aim-model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                disabled={!current || verifyBusy || saving}
              >
                <option value="">Select Model</option>
                {(models ?? []).map((m) => <option key={m.modelId} value={m.modelId}>{m.name}</option>)}
              </select>
              {model && (
                <span className="aim-clear" role="button" aria-label="Clear model" onClick={() => setModel('')}>×</span>
              )}
            </div>
            <p className="aim-copy">The application automatically fetches the latest available models from the selected provider.</p>

            {loadErr && <div className="aim-status err">{loadErr}</div>}
            {status && <div className={`aim-status ${status.ok ? 'ok' : 'err'}`}>{status.text}</div>}
          </div>
        </div>

        <div className="aim-divider" />
        <div className="aim-footer">
          <button className="btn btn-primary" onClick={verify} disabled={!current || verifyBusy || saving}>
            {verifyBusy ? <><span className="spin" /> Verifying…</> : 'Verify'}
          </button>
          <button className="btn btn-primary" onClick={done} disabled={!verified || !model || saving}>
            {saving ? <><span className="spin" /> Saving…</> : 'Done'}
          </button>
        </div>
      </div>
    </div>
  )
}

