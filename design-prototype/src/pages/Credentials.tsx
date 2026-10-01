import React, { useState, useEffect } from 'react'
import { Shell } from '../shell'
import { useStore } from '../store'
import { api, ApiCredentialRow } from '../api'
import { Modal, fmtDate, Status } from '../ui'
import { I } from '../icons2'
import { SecretField } from '../components/SecretField'
import { ProviderHub } from './Providers'

interface ProviderOption { providerId: string; providerName: string }

export function Credentials() {
  const { pushToast } = useStore()
  const [loading, setLoading] = useState(true)
  const [creds, setCreds] = useState<ApiCredentialRow[]>([])
  const [providers, setProviders] = useState<ProviderOption[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [providerId, setProviderId] = useState('')
  const [key, setKey] = useState('')
  const [adding, setAdding] = useState(false)
  const [verifying, setVerifying] = useState<string | null>(null)

  const load = async () => {
    try {
      const [c, p] = await Promise.all([api.credentials.list(), api.providers.list()])
      setCreds(c.credentials)
      const opts = p.providers
        .filter(x => x.credentialRequired)
        .map(x => ({ providerId: x.providerId, providerName: x.name }))
      setProviders(opts)
      if (!opts.some(o => o.providerId === providerId)) setProviderId(opts[0]?.providerId ?? '')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load().catch(() => setLoading(false)) }, [])

  const add = async () => {
    if (!key || !providerId) return
    setAdding(true)
    try {
      await api.credentials.add(providerId, key.trim())
      pushToast('Credential added â€” verify it with the provider to make its models selectable', 'success')
      setShowAdd(false); setKey('')
      load().catch(() => {})
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Could not add credential', 'error')
    } finally {
      setAdding(false)
    }
  }

  const remove = async (id: string) => {
    try {
      await api.credentials.delete(id)
      setCreds(c => c.filter(x => x.id !== id))
      pushToast('Credential removed', 'info')
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Could not remove credential', 'error')
    }
  }

  /* Re-verification (Â§31): the system calls the provider's verify endpoint;
     the user sees the real result. */
  const verify = async (id: string) => {
    if (verifying) return
    setVerifying(id)
    try {
      const result = await api.credentials.verify(id)
      setCreds(c => c.map(x => x.id === id ? { ...x, verified: result.success, lastError: result.errorMessage ?? null } : x))
      if (result.success) pushToast('Credential verified with the provider', 'success')
      else pushToast(result.errorMessage || 'Verification failed', 'error')
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Verification failed', 'error')
    } finally {
      setVerifying(null)
    }
  }

  if (loading) return <Shell breadcrumb={[{ label: 'Providers', route: '#/providers' }, { label: 'Credentials' }]}><div className="loading-screen"><div className="spinner" /></div></Shell>

  return (
    <Shell breadcrumb={[{ label: 'Providers', route: '#/providers' }, { label: 'Credentials' }]}>
<Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add credential"
          footer={<><button className="btn btn-ghost" onClick={() => setShowAdd(false)}>Cancel</button><button className="btn btn-primary" onClick={add} disabled={!key || !providerId || adding}>{adding ? <><span className="spin" /> Addingâ€¦</> : 'Add credential'}</button></>}>
          <div className="field"><label>Provider</label><select value={providerId} onChange={e => setProviderId(e.target.value)}>
            {providers.length === 0 ? <option value="">No credential-required providers available</option> : providers.map(p => <option key={p.providerId} value={p.providerId}>{p.providerName} ({p.providerId})</option>)}
          </select></div>
        <div className="field" style={{ marginBottom: 0 }}><label>Provider API key</label><SecretField value={key} onChange={setKey} placeholder="sk-..." data-testid="credential-api-key" /><div className="hint">The secret is accepted once, verified, and never shown, logged, or returned to the client.</div></div>
      </Modal>
      <div className="page-head"><div><h1>Credentials</h1><p className="subtitle">Your stored provider credentials.</p></div>
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}><I name="plus" /> Add credential</button></div>
      {creds.length === 0 ? <div className="empty-state"><div className="empty-icon">&#128273;</div><h3>No credentials</h3><p>Add a provider API key to connect a model.</p><button className="btn btn-primary mt-12" onClick={() => setShowAdd(true)}>Add credential</button></div> : (
        <div className="table-wrap"><table className="data"><thead><tr><th>Provider</th><th>Added</th><th>Verified</th><th>Last error</th><th></th></tr></thead>
          <tbody>{creds.map((c: ApiCredentialRow) => (
            <tr key={c.id}><td style={{ fontWeight: 600 }}>{providers.find(p => p.providerId === c.providerId)?.providerName || c.providerId}</td>
              <td className="text-sm muted">{fmtDate(c.createdAt)}</td>
              <td><Status status={c.verified ? 'connected' : 'auth_required'} /></td>
              <td className="text-sm muted">{c.lastError ? <span className="badge badge-red">failed</span> : 'â€”'}</td>
              <td><div className="row" style={{ gap: 6 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => verify(c.id)} disabled={verifying === c.id || c.providerId !== 'openrouter'} title={c.providerId !== 'openrouter' ? 'Verification is only implemented for OpenRouter' : undefined}>{verifying === c.id ? 'Verifyingâ€¦' : 'Verify'}</button>
                <button className="btn btn-ghost btn-sm" onClick={() => remove(c.id)} aria-label={'Remove ' + c.providerId}><I name="trash" size={14} /></button>
              </div></td></tr>
          ))}</tbody></table></div>
      )}
    </Shell>
  )
}

export function ModelSelection() {
  return (
    <ProviderHub
      title="Select a model"
      subtitle="Choose the active model. A model must have a connection verified against its provider before stages run for real â€” otherwise stages are recorded as checkpoints only."
      breadcrumb={[{ label: 'Providers', route: '#/providers' }, { label: 'Selection' }]}
    />
  )
}

