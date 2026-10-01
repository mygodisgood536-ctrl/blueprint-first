/**
 * SIGN IN / CREATE ACCOUNT - the public product authentication entry.
 *
 * Reached deliberately from the product welcome screen. Contains no reference
 * to any privileged role, no owner link, and no internal terminology. The only
 * destinations it can produce are the product itself, first-time setup, or
 * password recovery.
 */
import React, { useState } from 'react'
import { navigate } from '../router'
import { useStore } from '../store'
import { SecretField } from '../components/SecretField'

function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-bg">
      <div style={{ width: '100%', maxWidth: 440 }}>
        <div style={{ textAlign: 'center', marginBottom: 22 }}>
          <a href="#/welcome" style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
            <img src="/favicon.svg" alt="" width={32} height={32} />
            <span style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)' }}>NEXORA</span>
          </a>
        </div>
        <div className="auth-card card">{children}</div>
        <p className="center text-sm mt-16" style={{ color: 'var(--text-tertiary)' }}>
          Â© 2026 NEXORA
        </p>
      </div>
    </div>
  )
}

function Notice({ tone, children }: { tone: 'error' | 'info' | 'success'; children: React.ReactNode }) {
  const bg = tone === 'error' ? 'var(--danger-soft)' : tone === 'success' ? 'var(--success-soft)' : 'var(--info-soft)'
  const fg = tone === 'error' ? 'var(--danger)' : tone === 'success' ? 'var(--success)' : 'var(--info)'
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      style={{ padding: '10px 14px', borderRadius: 8, background: bg, color: fg, fontSize: 13, marginBottom: 16 }}
    >
      {children}
    </div>
  )
}

/**
 * Where a completed sign-in should land.
 *
 * The product is the only destination: the sign-in flow never routes anyone into
 * the private administration area. An administrator reaches that from their own
 * entry point or from the sidebar.
 */
function destinationFor(setupComplete: boolean): string {
  return setupComplete ? '#/dashboard' : '#/setup/recovery'
}

export function SignIn() {
  const store = useStore()
  const [mode, setMode] = useState<'signin' | 'create'>('signin')
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // An already signed-in account never needs this screen.
  React.useEffect(() => {
    if (store.auth.authenticated && store.auth.setupComplete) navigate('#/dashboard')
  }, [store.auth.authenticated, store.auth.setupComplete])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username.trim()) {
      setError('Enter your username.')
      return
    }
    if (mode === 'create') {
      if (username.trim().length < 3) {
        setError('Username must be at least 3 characters.')
        return
      }
      if (password.length < 8) {
        setError('Password must be at least 8 characters.')
        return
      }
      // The confirmation field only exists while creating an account. Checking
      // it when signing in would compare the typed password against an empty
      // string and block every returning user.
      if (password !== confirm) {
        setError('Passwords do not match.')
        return
      }
    }
    setError('')
    setBusy(true)
    try {
      if (mode === 'create') {
        const res = await store.userSignup(username.trim(), displayName.trim() || username.trim(), password)
        if (res.ok) {
          navigate('#/setup/recovery')
        } else {
          setError(res.reason || 'We could not create that account.')
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
      navigate(destinationFor(store.auth.setupComplete))
    } finally {
      setBusy(false)
    }
  }

  const creating = mode === 'create'

  return (
    <AuthShell>
      <h1 style={{ fontSize: 21, marginBottom: 4 }}>{creating ? 'Create your account' : 'Sign in'}</h1>
      <p className="muted text-sm mb-20">
        {creating ? 'Start your workspace in about a minute.' : 'Welcome back.'}
      </p>
      <form onSubmit={submit} noValidate>
        {error && <Notice tone="error">{error}</Notice>}
        <div className="field">
          <label htmlFor="auth-username">Username</label>
          <input
            id="auth-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="your-username"
            autoComplete="username"
            autoFocus
          />
        </div>
        {creating && (
          <div className="field">
            <label htmlFor="auth-display-name">Display name</label>
            <input
              id="auth-display-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="How your name appears in the workspace"
            />
          </div>
        )}
        <div className="field">
          <label htmlFor="auth-password">Password</label>
          <SecretField
            id="auth-password"
            value={password}
            onChange={setPassword}
            placeholder={creating ? 'At least 8 characters' : ''}
            autoComplete={creating ? 'new-password' : 'current-password'}
            data-testid="auth-password"
          />
        </div>
        {creating && (
          <div className="field">
            <label htmlFor="auth-confirm">Confirm password</label>
            <SecretField
              id="auth-confirm"
              value={confirm}
              onChange={setConfirm}
              placeholder="Re-enter your password"
              autoComplete="new-password"
              data-testid="auth-confirm"
            />
          </div>
        )}
        <button className="btn btn-primary btn-block btn-lg" disabled={busy} type="submit">
          {busy ? 'Workingâ€¦' : creating ? 'Create account' : 'Sign in'}
        </button>
      </form>
      <div className="divider" />
      <p className="center text-sm muted">
        {creating ? 'Already have an account? ' : 'New to NEXORA? '}
        <a
          href="#/signin"
          onClick={(e) => {
            e.preventDefault()
            setMode(creating ? 'signin' : 'create')
            setError('')
            setConfirm('')
          }}
        >
          {creating ? 'Sign in instead' : 'Create an account'}
        </a>
      </p>
      {!creating && (
        <p className="center text-sm mt-16" style={{ marginBottom: 0 }}>
          <a href="#/signin/recovery">Forgot your password?</a>
        </p>
      )}
    </AuthShell>
  )
}

/** Second step of a normal sign-in: the 6-digit authenticator code. */
export function SignInVerify() {
  const store = useStore()
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  React.useEffect(() => {
    if (store.loginChallenge === null && !store.auth.authenticated) navigate('#/signin')
  }, [store.loginChallenge, store.auth.authenticated])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const digits = code.replace(/\D/g, '')
    if (digits.length !== 6) {
      setError('Enter the 6-digit code from your authenticator app.')
      return
    }
    setError('')
    setBusy(true)
    const res = await store.loginVerify(digits)
    setBusy(false)
    if (res.ok) {
      navigate(destinationFor(store.auth.setupComplete))
    } else {
      setError('That code was not accepted. Check your authenticator app and try again.')
    }
  }

  return (
    <AuthShell>
      <h1 style={{ fontSize: 21, marginBottom: 4 }}>Two-step verification</h1>
      <p className="muted text-sm mb-20">
        Enter the current 6-digit code from your authenticator app to finish signing in.
      </p>
      <form onSubmit={submit} noValidate>
        {error && <Notice tone="error">{error}</Notice>}
        <div className="field">
          <label htmlFor="verify-code">6-digit code</label>
          <input
            id="verify-code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            style={{ letterSpacing: '0.4em', fontSize: 20, textAlign: 'center' }}
            data-testid="verify-code"
          />
        </div>
        <button className="btn btn-primary btn-block btn-lg" disabled={busy} type="submit">
          {busy ? 'Verifyingâ€¦' : 'Verify'}
        </button>
      </form>
      <div className="divider" />
      <p className="center text-sm">
        <a
          href="#/signin"
          onClick={(e) => {
            e.preventDefault()
            store.clearLoginChallenge()
            navigate('#/signin')
          }}
        >
          â† Back to sign in
        </a>
      </p>
    </AuthShell>
  )
}

