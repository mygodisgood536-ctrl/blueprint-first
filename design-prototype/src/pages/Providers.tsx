import React, { useState, useEffect } from 'react'
import { Shell } from '../shell'
import { api, ApiModelRow, ApiProviderDescriptor, ApiSelectionState } from '../api'
import { Status } from '../ui'
import { I } from '../icons2'
import { SecretField } from '../components/SecretField'

const CAT_ICON: Record<string, string> = {
  free_no_api_key: 'ðŸŒ', free_api_key_required: 'ðŸ”‘', free_oauth: 'ðŸ‘¤',
  platform_provided: 'âš™ï¸', paid: 'ðŸ’³', local: 'ðŸ–¥ï¸',
}

const FREE_CATS = ['free_no_api_key', 'free_api_key_required', 'free_oauth', 'local']
const SUB_CATS = ['paid', 'platform_provided']

const MODEL_PAGE = 30

/* Shared model row (also used by ModelSelection via ProviderHub). */
function ModelRow({
  m,
  selected,
  onSelect,
}: { m: ApiModelRow; selected: boolean; onSelect: () => void }) {
  const cat = m.accessCategory || 'paid'
  return (
    <div
      className="card card-hover row-between"
      style={{ cursor: 'pointer', borderColor: selected ? 'var(--green-500)' : 'var(--border)' }}
      onClick={onSelect}
      role="button"
      aria-label={`Select ${m.name}`}
    >
      <div className="row" style={{ gap: 12 }}>
        <div style={{ fontSize: 18 }}>{CAT_ICON[cat] ?? 'ðŸ§¬'}</div>
        <div>
          <div style={{ fontWeight: 600 }}>{m.name}<span className="text-xs muted" style={{ marginLeft: 8 }}>{m.providerName || m.providerId}</span></div>
          <div className="text-xs muted">{m.modelId}</div>
          <div className="text-xs muted">
            ctx {Math.round((m.contextLength || 0) / 1000)}K Â· out {Math.round((m.maxOutputTokens || 0) / 1000)}K Â·{' '}
            {m.inputCostPer1M === null && m.outputCostPer1M === null
              ? 'Free'
              : `$${(m.inputCostPer1M ?? 0).toFixed(2)} in / $${(m.outputCostPer1M ?? 0).toFixed(2)} out /1M`}
          </div>
        </div>
      </div>
      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
        <span className="badge badge-gray">{cat.replace(/_/g, ' ')}</span>
        <span className={`badge ${m.verified ? 'badge-green' : 'badge-yellow'}`}>{m.verified ? 'verified' : 'listed'}</span>
        {selected && <span className="badge badge-green">Selected</span>}
      </div>
    </div>
  )
}

/* Inline credential step shown only when the backend says a credential is required. */
function CredentialStep({ provider, onState }: { provider: ApiProviderDescriptor; onState: () => void }) {
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  const add = async () => {
    if (!key.trim()) return
    setBusy(true)
    setNote('')
    try {
      await api.credentials.add(provider.providerId, key.trim())
      await api.providers.verify(provider.providerId)
      setKey('')
      setNote('Key added and verified with the provider.')
      onState()
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Could not save or verify the key')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="warn-card card mt-12" style={{ padding: '12px 14px' }}>
      <div className="text-sm" style={{ fontWeight: 600 }}>API key required</div>
      <div className="text-xs muted" style={{ margin: '4px 0 10px' }}>Add and verify a key so models from this provider become selectable. The secret is sent once and never shown again.</div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <SecretField value={key} onChange={setKey} placeholder="sk-..." data-testid="provider-api-key" />
        </div>
        <button className="btn btn-primary btn-sm" onClick={add} disabled={!key.trim() || busy}>
          {busy ? <><span className="spin" /> Verifyingâ€¦</> : 'Add & verify'}
        </button>
      </div>
      {note && <div className="text-xs mt-8" style={{ color: note.startsWith('Key added') ? 'var(--green-700)' : 'var(--danger)' }}>{note}</div>}
    </div>
  )
}

function ProviderCard({
  provider,
  selection,
  onState,
}: { provider: ApiProviderDescriptor; selection: ApiSelectionState | null; onState: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [models, setModels] = useState<ApiModelRow[]>([])
  const [total, setTotal] = useState(0)
  const [q, setQ] = useState('')
  const [error, setError] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [verifyNote, setVerifyNote] = useState('')
  const [selecting, setSelecting] = useState<string | null>(null)
  const [page, setPage] = useState(1)

  const loadModels = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.models.list({ providerId: provider.providerId, q: q || undefined })
      setModels(res.models.slice(0, MODEL_PAGE))
      setTotal(res.total)
      if (res.localHubUnavailable) setError('No local runtime is configured in this environment, so no local models are available here.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load models for this provider')
    } finally {
      setLoading(false)
    }
  }

  const verify = async () => {
    setVerifying(true)
    setVerifyNote('')
    try {
      const res = await api.providers.verify(provider.providerId)
      setVerifyNote(res.success
        ? `Connection verified (${res.modelsAvailable ?? ''} models available)`.trim()
        : (res.errorMessage || 'Verification failed'))
      onState()
    } catch (err) {
      setVerifyNote(err instanceof Error ? err.message : 'Verification failed')
    } finally {
      setVerifying(false)
    }
  }

  const open = () => {
    setExpanded(true)
    if (models.length === 0 && !loading) loadModels()
  }
  const close = () => setExpanded(false)

  const selectModel = async (m: ApiModelRow) => {
    setSelecting(m.modelId)
    try {
      const res = await api.models.select(m.providerId, m.modelId)
      if (res.selection.connectionVerified) {
        setVerifyNote(`Selected ${m.modelId} â€” connection verified.`)
      } else {
        setVerifyNote(`${m.modelId}: ${res.selection.status.replace(/_/g, ' ')} â€” listed but no verified access yet.`)
      }
      onState()
    } catch (err) {
      setVerifyNote(err instanceof Error ? err.message : 'Selection failed')
    } finally {
      setSelecting(null)
    }
  }

  const stateText = provider.connectionVerified
    ? 'Connection verified'
    : provider.configured
      ? 'Configured â€” verify to make models selectable'
      : provider.authMethod === 'none'
        ? 'No credential needed â€” verify connection to continue'
        : 'Not configured'

  return (
    <div className="card">
      <div className="row-between">
        <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--green-deep)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 16 }}>{provider.name[0]}</div>
          <div>
            <h4 style={{ margin: 0 }}>{provider.name}<span className="text-xs muted" style={{ marginLeft: 8 }}>{provider.providerId}</span></h4>
            <div className="text-xs muted" style={{ marginTop: 2 }}>{provider.description}</div>
            <div className="row" style={{ gap: 8, marginTop: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className={`badge ${provider.credentialRequired ? 'badge-yellow' : 'badge-green'}`}>{provider.credentialRequired ? 'API key required' : 'No key needed'}</span>
              {typeof provider.modelCount === 'number' ? <span className="badge badge-gray">{provider.modelCount} models in catalogue</span> : null}
              <Status status={provider.connectionVerified ? 'connected' : provider.configured ? 'auth_required' : 'notRun'} />
            </div>
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {provider.configured && (
            <button className="btn btn-ghost btn-sm" onClick={verify} disabled={verifying} aria-label={`Verify connection to ${provider.providerId}`}>
              {verifying ? <><span className="spin" /> Verifyingâ€¦</> : 'Verify connection'}
            </button>
          )}
          {expanded
            ? <button className="btn btn-ghost btn-sm" onClick={close}>Collapse</button>
            : <button className="btn btn-primary btn-sm" onClick={open}>Browse models</button>}
        </div>
      </div>

      {!provider.configured && provider.credentialRequired && (
        <CredentialStep provider={provider} onState={onState} />
      )}

      <div className="text-xs muted" style={{ marginTop: 8 }}>{stateText}</div>
      {verifyNote && <div className="text-xs" style={{ marginTop: 4, color: verifyNote.startsWith('Selected') || verifyNote.startsWith('Connection verified') ? 'var(--green-700)' : 'var(--text-secondary)' }}>{verifyNote}</div>}

      {expanded && (
        <div style={{ marginTop: 14 }}>
          <div className="row" style={{ gap: 8 }}>
            <input
              value={q}
              placeholder={`Search ${provider.providerId} modelsâ€¦`}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') loadModels() }}
              style={{ flex: 1, padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 8, outline: 'none' }}
            />
            <button className="btn btn-ghost btn-sm" onClick={loadModels} disabled={loading}>Search</button>
          </div>
          {error && <div className="text-sm mt-8" style={{ color: 'var(--danger)' }}>{error}</div>}
          {loading ? <div className="loading-screen" style={{ padding: 20 }}><div className="spinner" /></div> : (
            <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
              {models.length === 0 && !error && <div className="empty-state" style={{ padding: '24px 0' }}><div className="empty-icon">ðŸ«™</div><h3>No models listed</h3><p>No models matched for this provider{provider.authMethod === 'none' ? ' â€” is a local runtime serving models?' : ''}.</p></div>}
              {models.map((m) => (
                <ModelRow
                  key={`${m.providerId}:${m.modelId}`}
                  m={m}
                  selected={!!selection && selection.providerId === m.providerId && selection.modelId === m.modelId}
                  onSelect={() => selectModel(m)}
                />
              ))}
              {total > MODEL_PAGE && (
                <div className="text-xs muted" style={{ textAlign: 'center', padding: 4 }}>
                  Showing {models.length} of {total} â€” refine the search to narrow results.
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {selecting && <div className="loading-screen" style={{ position: 'fixed' }}><div className="spinner" /></div>}
    </div>
  )
}

export function Providers() {
  return <ProviderHub title="Providers & models" subtitle="Which provider is NEXORA using, and is it working? Configure, verify, then select a model to run stages for real." breadcrumb={[{ label: 'Providers' }]} />
}

/** Fast Provider Hub: provider cards from /api/providers (small), models loaded
 *  lazily per provider, real catalogue search across provider and model. */
export function ProviderHub({
  title, subtitle, breadcrumb,
}: { title: string; subtitle: string; breadcrumb: Array<{ label: string; route?: string }> }) {
  const [loading, setLoading] = useState(true)
  const [providers, setProviders] = useState<ApiProviderDescriptor[]>([])
  const [selection, setSelection] = useState<ApiSelectionState | null>(null)
  const [tier, setTier] = useState<'free' | 'subscription'>('free')
  const [search, setSearch] = useState('')
  const [liveSearch, setLiveSearch] = useState('')
  const [searchResults, setSearchResults] = useState<ApiModelRow[] | null>(null)
  const [searchTotal, setSearchTotal] = useState(0)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')
  const activeCats = tier === 'free' ? FREE_CATS : SUB_CATS

  const refresh = async () => {
    setError('')
    try {
      const [p, s] = await Promise.all([api.providers.list(), api.models.selection()])
      setProviders(p.providers)
      setSelection(s.selection)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reach the provider hub')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let alive = true
    refresh().then(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => setLiveSearch(search), 250)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    if (!liveSearch.trim()) { setSearchResults(null); setSearchTotal(0); return }
    let alive = true
    setSearching(true)
    api.models.list({ q: liveSearch.trim(), accessCategory: activeCats })
      .then((res) => {
        if (!alive) return
        setSearchResults(res.models.slice(0, MODEL_PAGE))
        setSearchTotal(res.total)
        if (res.localHubUnavailable) setError('Local runtime is not configured in this environment.')
        else setError('')
      })
      .catch((err) => { if (alive) setError(err instanceof Error ? err.message : 'Search failed') })
      .finally(() => { if (alive) setSearching(false) })
    return () => { alive = false }
  }, [liveSearch, tier])

  const doSelect = async (m: ApiModelRow) => {
    try {
      const res = await api.models.select(m.providerId, m.modelId)
      setSelection(res.selection)
      if (res.selection.connectionVerified) setError('')
      else setError(`${m.modelId}: ${res.selection.status.replace(/_/g, ' ')} â€” listed but not verified accessible.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Selection failed')
    }
  }

  if (loading) return <Shell breadcrumb={breadcrumb}><div className="loading-screen"><div className="spinner" /></div></Shell>

  return (
    <Shell breadcrumb={breadcrumb}>
      <div className="page-head">
        <div>
          <h1>{title}</h1>
          <p className="subtitle">{subtitle}</p>
        </div>
        <a href="#/providers/credentials" className="btn btn-ghost"><I name="key" size={14} /> Manage credentials</a>
      </div>

      {selection
        ? (
          <div className="card mb-16" style={{ borderColor: 'var(--green-500)' }}>
            <div className="row-between">
              <div className="row" style={{ gap: 12 }}>
                <I name="check" size={18} />
                <div>
                  <div style={{ fontWeight: 600 }}>Active model: {selection.modelId} <span className="text-xs muted">({selection.providerId})</span></div>
                  <div className="text-xs muted">Stages on your projects are executed through this model once its connection is verified.</div>
                </div>
              </div>
              <Status status={selection.connectionVerified ? 'connected' : selection.status} />
            </div>
          </div>
        )
        : (
          <div className="warn-card card mb-16">
            <div className="text-sm" style={{ fontWeight: 600 }}>No verified model selected</div>
            <div className="text-xs muted" style={{ marginTop: 2 }}>Until you verify a provider connection and select a model, project stages are recorded as checkpoints only â€” no provider request is made.</div>
          </div>
        )}

      <div className="card mb-16" style={{ padding: '14px 16px' }}>
        <input
          placeholder="Search provider or model against the real catalogueâ€¦"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: '100%', padding: '10px 14px', border: '1px solid var(--border)', borderRadius: 10, outline: 'none' }}
          aria-label="Search providers or models"
        />
        <div className="seg-row" style={{ marginTop: 12, marginBottom: 0 }}>
          <button className={`seg ${tier === 'free' ? 'active' : ''}`} onClick={() => setTier('free')}>Free & local</button>
          <button className={`seg ${tier === 'subscription' ? 'active' : ''}`} onClick={() => setTier('subscription')}>Subscription</button>
        </div>
      </div>

      {error && <div className="danger-box mb-16">{error}</div>}

      {searching && <div className="loading-screen" style={{ padding: 16 }}><div className="spinner" /></div>}

      {liveSearch.trim() ? (
        <div style={{ display: 'grid', gap: 8 }}>
          {searchResults === null ? null : searchResults.length === 0 && !searching ? (
            <div className="empty-state"><div className="empty-icon">ðŸ”Ž</div><h3>No matches</h3><p>No {tier === 'free' ? 'free/local' : 'subscription'} models matched â€œ{liveSearch}â€ in the catalogue.</p></div>
          ) : searchResults.map((m) => (
            <ModelRow
              key={`${m.providerId}:${m.modelId}`}
              m={m}
              selected={!!selection && selection.providerId === m.providerId && selection.modelId === m.modelId}
              onSelect={() => doSelect(m)}
            />
          ))}
          {searchTotal > MODEL_PAGE && <div className="text-xs muted" style={{ textAlign: 'center', padding: 4 }}>Showing {searchResults?.length ?? 0} of {searchTotal} â€” refine your search.</div>}
        </div>
      ) : (
        <>
          <div className="text-sm muted mb-12" style={{ fontWeight: 700 }}>Providers you can connect</div>
          <div style={{ display: 'grid', gap: 16 }}>
            {providers.map((p) => (
              <ProviderCard key={p.providerId} provider={p} selection={selection} onState={() => refresh()} />
            ))}
          </div>
        </>
      )}
    </Shell>
  )
}

export default Providers

