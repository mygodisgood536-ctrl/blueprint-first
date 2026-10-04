import React, { useState, useEffect } from 'react'
import { Shell } from '../shell'
import { useStore } from '../store'

/* ==========================================================================
   Account area - §11 Settings
   Profile · Preferences

   There is deliberately NO password, authenticator (TOTP), recovery-code,
   security-events or session-management screen here. The account's only
   credential is its security question + answer, which is fixed at sign-up and
   is not editable from the product. Nothing in this file authenticates anyone.
   ========================================================================== */

function fmtDate(iso: string) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

export function Profile() {
  const { auth, updateProfile } = useStore()
  const [editing, setEditing] = useState(false)
  const [fullName, setFullName] = useState(auth.fullName)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!fullName.trim()) { setError('Name cannot be empty.'); return }
    setError(''); setLoading(true)
    try {
      await updateProfile(fullName.trim())
      setEditing(false)
    } catch { /* toast already shown */ }
    setLoading(false)
  }

  return (
    <Shell breadcrumb={[{ label: 'Account' }, { label: 'Profile' }]}>
      <div style={{ maxWidth: 640 }}>
        <div className="card">
          <div className="row-between">
            <h4 className="mb-4">Profile</h4>
            {!editing && <button className="btn btn-ghost btn-sm" onClick={() => { setEditing(true); setError('') }}>Edit</button>}
          </div>
          {editing ? (
            <form onSubmit={save} className="mt-8">
              {error && <div className="danger-box mt-8">{error}</div>}
              <div className="field"><label>Full name</label><input value={fullName} onChange={e => setFullName(e.target.value)} autoFocus /></div>
              <div className="hint">Your Gmail, username and security question identify your account and are fixed at sign-up.</div>
              <div className="frow" style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                <button className="btn btn-primary" disabled={loading} type="submit">{loading ? 'Saving…' : 'Save changes'}</button>
                <button className="btn btn-ghost" type="button" onClick={() => { setEditing(false); setFullName(auth.fullName); setError('') }}>Cancel</button>
              </div>
            </form>
          ) : (
            <div className="profile-grid mt-8">
              <div className="profile-avatar">{auth.fullName?.[0]?.toUpperCase() || 'U'}</div>
              <div>
                <div className="kv"><span>Full name</span><strong>{auth.fullName}</strong></div>
                <div className="kv"><span>Username</span><span className="mono">{auth.username}</span></div>
                <div className="kv"><span>Gmail</span><span className="mono">{auth.gmail}</span></div>
                <div className="kv"><span>Security question</span><span>{auth.securityQuestion}</span></div>
                <div className="kv"><span>Role</span><span>{auth.role}</span></div>
                <div className="kv"><span>Member since</span><span>{auth.createdAt ? fmtDate(auth.createdAt) : '—'}</span></div>
                <div className="kv"><span>Account ID</span><span className="mono">{auth.id || '—'}</span></div>
              </div>
            </div>
          )}
        </div>
      </div>
    </Shell>
  )
}
/* ==========================================================================
   Preferences — §11 «Settings → Preferences»
   ========================================================================== */

export function Preferences() {
  const { preferences, fetchPreferences, updatePreferences } = useStore()
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    fetchPreferences()
      .catch(() => {})
      .finally(() => { if (alive) setLoaded(true) })
    return () => { alive = false }
  }, [fetchPreferences])

  const valueOf = (key: string): boolean => {
    if (preferences[key] === undefined) return true
    return preferences[key] === true
  }

  const toggle = async (key: string, value: boolean) => {
    setSaving(true)
    try {
      await updatePreferences({ ...preferences, [key]: value })
      setLoaded(true)
    } catch { /* toast already shown */ }
    setSaving(false)
  }

  return (
    <Shell breadcrumb={[{ label: 'Account' }, { label: 'Preferences' }]}>
      <div style={{ display: 'grid', gap: 16 }}>
        <div>
          <h2 style={{ fontSize: 18, marginBottom: 4 }}>Preferences</h2>
          <p className="muted" style={{ fontSize: 13 }}>Personalize your NEXORA workspace. Preferences are stored per account.</p>
        </div>
        <div className="card">
          <h4 className="mb-12">Notifications</h4>
          {!loaded ? <div className="muted text-sm">Loading…</div> : (
            <div style={{ display: 'grid', gap: 12 }}>
              <div className="row-between">
                <div><div>In-app notifications</div><div className="muted text-sm">Show toast and bell notifications in the workspace.</div></div>
                <label className="switch"><input type="checkbox" checked={valueOf('notificationsEnabled')} onChange={e => toggle('notificationsEnabled', e.target.checked)} disabled={saving} /><span className="track" /></label>
              </div>
              <div className="row-between">
                <div><div>Reduce motion</div><div className="muted text-sm">Minimise animation across the workspace.</div></div>
                <label className="switch"><input type="checkbox" checked={valueOf('reduceMotion')} onChange={e => toggle('reduceMotion', e.target.checked)} disabled={saving} /><span className="track" /></label>
              </div>
            </div>
          )}
        </div>
      </div>
    </Shell>
  )
}
