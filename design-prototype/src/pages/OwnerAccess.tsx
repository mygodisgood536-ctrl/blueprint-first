/**
 * PRIVATE OWNER ENTRY
 *
 * A deliberately private, unadvertised entry point used to create and sign in to
 * the account that administers the platform. It is not linked from the product
 * interface and is not discoverable from the public navigation.
 *
 * The page is written as a production console access screen: it identifies the
 * product and the action, not the account's internal role label. The role itself
 * is fixed server-side and enforced there; nothing in this UI grants it.
 */
import React, { useState } from 'react'
import { navigate } from '../router'
import { api } from '../api'
import { useStore } from '../store'
import { SecretField } from '../components/SecretField'

export function OwnerAccess() {
  const store = useStore()
  const [mode, setMode] = useState<'checking' | 'create' | 'signin'>('checking')
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // First-time administration is offered only while no administrator exists.
  React.useEffect(() => {
    let cancelled = false
    void api.auth
      .ownerExists()
      .then((res) => {
        if (!cancelled) setMode(res.ownerExists ? 'signin' : 'create')
      })
      .catch(() => {
        if (!cancelled) setMode('signin')
      })
    return () => {
      cancelled = true
    }
  }, [])

  React.useEffect(() => {
    if (store.auth.authenticated && store.auth.setupComplete) {
      navigate(store.auth.role === 'admin' ? '#/owner/settings' : '#/dashboard')
    }
  }, [store.auth.authenticated, store.auth.setupComplete, store.auth.role])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username.trim()) {
      setError('Enter a username.')
      return
    }
    if (mode === 'create') {
      if (password.length < 8) {
        setError('Password must be at least 8 characters.')
        return
      }
      // The confirmation field only exists while creating the account. Checking
      // it when signing in would compare the typed password against an empty
      // string and block every returning administrator.
      if (password !== confirm) {
        setError('Passwords do not match.')
        return
      }
    }
    setError('')
    setBusy(true)
    try {
      if (mode === 'create') {
        const res = await store.ownerSignup(username.trim(), displayName.trim() || username.trim(), password)
        if (res.ok) {
          // Every new account completes the same first-time setup.
          navigate('#/setup/recovery')
        } else {
          setError(res.reason || 'We could not complete that request.')
        }
        return
      }
      const res = await store.login(username.trim(), password)
      if (!res.ok) {
        setError('That username and password do not match.')
        return
      }
      if (res.requiresAuthenticator === true) {
        navigate('#/signin/verify')
        return
      }
      navigate('#/owner/settings')
    } finally {
      setBusy(false)
    }
  }

  const creating = mode === 'create'

  return (
    <div className="auth-bg auth-bg-private">
      <div style={{ width: '100%', maxWidth: 430 }}>
        <div style={{ textAlign: 'center', marginBottom: 22 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
            <img src="/favicon.svg" alt="" width={30} height={30} />
            <span style={{ fontSize: 19, fontWeight: 800, color: 'var(--text-primary)' }}>NEXORA</span>
            <span className="private-tag">Administration</span>
          </div>
        </div>
        <div className="auth-card card" style={{ borderColor: 'var(--border-strong)' }}>
          {mode === 'checking' ? (
            <p className="muted text-sm" style={{ marginBottom: 0 }}>
              Checking availabilityâ€¦
            </p>
          ) : (
            <>
              <h1 style={{ fontSize: 20, marginBottom: 4 }}>
                {creating ? 'Create the administration account' : 'Administration sign in'}
              </h1>
              <p className="muted text-sm mb-20">
                {creating
                  ? 'This account administers platform configuration for this installation. Only one can exist.'
                  : 'Sign in to continue to platform configuration.'}
              </p>
              <form onSubmit={submit} noValidate>
                {error && (
                  <div
                    role="alert"
                    style={{
                      padding: '10px 14px',
                      borderRadius: 8,
                      background: 'var(--danger-soft)',
                      color: 'var(--danger)',
                      fontSize: 13,
                      marginBottom: 16,
                    }}
                  >
                    {error}
                  </div>
                )}
                <div className="field">
                  <label htmlFor="owner-username">Username</label>
                  <input
                    id="owner-username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="username"
                    autoComplete="username"
                    autoFocus
                  />
                </div>
                {creating && (
                  <div className="field">
                    <label htmlFor="owner-display-name">Display name</label>
                    <input
                      id="owner-display-name"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Optional"
                    />
                  </div>
                )}
                <div className="field">
                  <label htmlFor="owner-password">Password</label>
                  <SecretField
                    id="owner-password"
                    value={password}
                    onChange={setPassword}
                    placeholder={creating ? 'At least 8 characters' : ''}
                    autoComplete={creating ? 'new-password' : 'current-password'}
                    data-testid="owner-password"
                  />
                </div>
                {creating && (
                  <div className="field">
                    <label htmlFor="owner-confirm">Confirm password</label>
                    <SecretField
                      id="owner-confirm"
                      value={confirm}
                      onChange={setConfirm}
                      placeholder="Re-enter your password"
                      autoComplete="new-password"
                      data-testid="owner-confirm"
                    />
                  </div>
                )}
                <button className="btn btn-primary btn-block btn-lg" disabled={busy} type="submit">
                  {busy ? 'Workingâ€¦' : creating ? 'Create account' : 'Sign in'}
                </button>
              </form>
              <div className="divider" />
              <p className="center text-sm muted" style={{ marginBottom: 0 }}>
                {creating ? 'Already set up? ' : 'Setting this installation up for the first time? '}
                <a
                  href="#/owner"
                  onClick={(e) => {
                    e.preventDefault()
                    setMode(creating ? 'signin' : 'create')
                    setError('')
                    setConfirm('')
                  }}
                >
                  {creating ? 'Sign in instead' : 'Create the account'}
                </a>
              </p>
            </>
          )}
        </div>
        <p className="center text-sm mt-16" style={{ color: 'var(--text-tertiary)' }}>
          Â© 2026 NEXORA
        </p>
      </div>
    </div>
  )
}

