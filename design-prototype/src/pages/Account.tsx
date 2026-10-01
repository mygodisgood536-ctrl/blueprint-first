import React, { useState, useEffect } from 'react'
import QRCode from 'qrcode'
import { Shell } from '../shell'
import { useStore } from '../store'
import { api, authApi } from '../api'
import { navigate } from '../router'
import { I, IconName } from '../icons2'
import { RecoveryAnswers } from './RecoveryAnswers'
import { SecretDisplay, SecretField } from '../components/SecretField'

/* ==========================================================================
   Account area â€” Â§11 Settings
   Profile Â· Security hub Â· Password Â· Authenticator (TOTP) Â· Sessions Â·
   Security Events Â· Preferences
   ========================================================================== */

/* ---------- Account data shapes (wired to authApi) ---------- */

interface SessionRow {
  createdAt: string
  current: boolean
}

interface EventRow {
  id: string
  kind: 'login' | 'logout' | 'password' | 'authenticator' | 'profile'
  time: string
  detail: string
  origin: string
}

/* Recovery codes are returned once by the backend at authenticator enable. */

function fmtDate(iso: string) {
  if (!iso) return 'â€”'
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

function fmtDateTime(iso: string) {
  if (!iso) return 'â€”'
  const d = new Date(iso)
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/* Real QR image rendered from the backend-generated otpauth:// URI. The
   provisioning URI is only ever displayed to its owner during enrollment.
   Rendered locally with the vendored `qrcode` encoder â€” the secret NEVER
   leaves the browser (no third-party QR image service). */
function RealQr({ otpauth }: { otpauth: string }) {
  const [dataUrl, setDataUrl] = useState<string>('')
  useEffect(() => {
    let cancelled = false
    QRCode.toDataURL(otpauth, { width: 220, margin: 1, errorCorrectionLevel: 'M' })
      .then((url: string) => { if (!cancelled) setDataUrl(url) })
      .catch(() => { /* otpauth is always valid here; render nothing if it fails */ })
    return () => { cancelled = true }
  }, [otpauth])
  return (
    <div className="qr-box" aria-label="QR code â€” scan with your authenticator app">
      {dataUrl
        ? <img src={dataUrl} alt="Authenticator QR code" width={220} height={220} loading="eager" />
        : <div style={{ width: 220, height: 220, display: 'grid', placeItems: 'center', color: 'var(--text-tertiary)' }}>Renderingâ€¦</div>}
      <div className="qr-caption">Scan with your authenticator app</div>
    </div>
  )
}

/* Groups a base32 secret into 4-character chunks for easier manual entry. */
function groupSecret(secret: string): string {
  return secret.replace(/(.{4})/g, '$1 ').trim()
}
/* ==========================================================================
   Profile â€” Â§11 Â«Settings â†’ ProfileÂ»
   ========================================================================== */

export function Profile() {
  const { auth, updateProfile, pushToast } = useStore()
  const [editing, setEditing] = useState(false)
  const [displayName, setDisplayName] = useState(auth.displayName)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!displayName.trim()) { setError('Display name cannot be empty.'); return }
    setError(''); setLoading(true)
    try {
      await updateProfile(displayName.trim())
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
            {!editing && <button className="btn btn-ghost btn-sm" onClick={() => { setEditing(true); setError('') }}><I name="edit" size={16} /> Edit</button>}
          </div>
          {editing ? (
            <form onSubmit={save} className="mt-8">
              {error && <div className="danger-box mt-8">{error}</div>}
              <div className="field"><label>Display name</label><input value={displayName} onChange={e => setDisplayName(e.target.value)} autoFocus /></div>
              <div className="hint">Email is not stored by this deployment â€” accounts are identified by username only.</div>
              <div className="frow" style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                <button className="btn btn-primary" disabled={loading} type="submit">{loading ? <><span className="spin" /> Savingâ€¦</> : 'Save changes'}</button>
                <button className="btn btn-ghost" type="button" onClick={() => { setEditing(false); setDisplayName(auth.displayName); setError('') }}>Cancel</button>
              </div>
            </form>
          ) : (
            <div className="profile-grid mt-8">
              <div className="profile-avatar">{auth.displayName?.[0]?.toUpperCase() || 'U'}</div>
              <div>
                <div className="kv"><span>Display name</span><strong>{auth.displayName}</strong></div>
                <div className="kv"><span>Username</span><span className="mono">{auth.username}</span></div>
                <div className="kv"><span>Role</span><span>{auth.role || 'â€”'}</span></div>
                <div className="kv"><span>Member since</span><span>{auth.createdAt ? new Date(auth.createdAt).toLocaleDateString() : 'â€”'}</span></div>
                <div className="kv"><span>Account ID</span><span className="mono">{auth.id || 'â€”'}</span></div>
              </div>
            </div>
          )}
        </div>
      </div>
    </Shell>
  )
}
/* ==========================================================================
   Security hub â€” Â§11 Â«Settings â†’ SecurityÂ»
   ========================================================================== */

export function Security() {
  const { auth } = useStore()
  const entries: { icon: IconName; t: string; href: string; desc: string; tag?: string }[] = [
    { icon: 'key', t: 'Password', href: '#/settings/security/password', desc: 'Password is set. Change it anytime.' },
    { icon: 'shield', t: 'Authenticator', href: '#/settings/security/authenticator', desc: auth.totpEnabled ? 'TOTP is enabled.' : 'TOTP is not enabled yet.', tag: auth.totpEnabled ? 'On' : 'Off' },
    { icon: 'cpu', t: 'Sessions', href: '#/settings/security/sessions', desc: 'View and revoke active sessions' },
    { icon: 'activity', t: 'Security events', href: '#/settings/security/events', desc: 'Review recent security events' },
  ]
  return (
    <Shell breadcrumb={[{ label: 'Account' }, { label: 'Security' }]}>
      <div style={{ display: 'grid', gap: 16 }}>
        <div>
          <h2 style={{ fontSize: 18, marginBottom: 4 }}>Security settings</h2>
          <p className="muted" style={{ fontSize: 13 }}>Manage your password, authentication, sessions, and activity.</p>
        </div>
        {entries.map((p) => (
          <div key={p.t} className="card clickable" style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 16, alignItems: 'center' }}>
            <div className="row" style={{ gap: 12, alignItems: 'center' }}>
              <div className="sec-icon"><I name={p.icon} size={20} /></div>
              <div>
                <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                  <h4 style={{ marginBottom: 4 }}>{p.t}</h4>
                  {p.tag && <span className={`badge ${p.tag === 'On' ? 'badge-green' : 'badge-gray'}`}>{p.tag}</span>}
                </div>
                <div className="muted" style={{ fontSize: 13 }}>{p.desc}</div>
              </div>
            </div>
            <a className="btn btn-ghost" href={p.href}>Open</a>
          </div>
        ))}
      </div>
    </Shell>
  )
}

/* ==========================================================================
   Password â€” Â§11 Â«Settings â†’ Security â†’ PasswordÂ»
   ========================================================================== */

export function Password() {
  const { changePassword } = useStore()
  const [pwd, setPwd] = useState('')
  const [confirm, setConfirm] = useState('')
  const [answers, setAnswers] = useState<Array<{ questionId: string; answer: string }>>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (pwd.length < 8) { setError('New password must be at least 8 characters.'); return }
    if (pwd !== confirm) { setError('Passwords do not match.'); return }
    if (answers.length === 0 || answers.some((a) => a.answer.trim().length === 0)) {
      setError('Answer every recovery question.'); return
    }
    setError(''); setLoading(true)
    try {
      await changePassword(pwd, answers)
      setPwd(''); setConfirm(''); setAnswers([])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Password change failed.')
    } finally { setLoading(false) }
  }
  return (
    <Shell breadcrumb={[{ label: 'Account' }, { label: 'Security' }, { label: 'Password' }]}>
      <div style={{ maxWidth: 560 }}>
        <h2 style={{ fontSize: 18, marginBottom: 4 }}>Change password</h2>
        <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>
          A password change is a sensitive action: you must answer your recovery questions first. Changing
          your password signs out every other session.
        </p>
        <div className="card">
          <form onSubmit={submit}>
            {error && <div className="danger-box">{error}</div>}
            <RecoveryAnswers
              onChange={setAnswers}
              submitLabel="Continue"
              busy={loading}
              onSubmit={() => undefined}
            />
            <div className="field" style={{ marginTop: 16 }}><label>New password</label><SecretField value={pwd} onChange={setPwd} placeholder="At least 8 characters" autoComplete="new-password" data-testid="settings-new-password" /></div>
            <div className="field"><label>Confirm new password</label><SecretField value={confirm} onChange={setConfirm} autoComplete="new-password" data-testid="settings-confirm-password" /></div>
            <button className="btn btn-primary" disabled={loading} type="submit">{loading ? <><span className="spin" /> Savingâ€¦</> : 'Update password'}</button>
          </form>
        </div>
      </div>
    </Shell>
  )
}
/* ==========================================================================
   Authenticator â€” Â§11 Â«Settings â†’ Security â†’ AuthenticatorÂ» (TOTP, Â§9.6)
   Not set up: Add â†’ QR/manual key â†’ verify first code â†’ save recovery codes.
   Set up: summary, Replace (re-enroll), Remove (confirm with current code).
   ========================================================================== */

function AuthenticatorSetup() {
  const { pushToast, fetchTotpSetup, enableTotp, totpSetup } = useStore()
  const [step, setStep] = useState(1)
  const [answers, setAnswers] = useState<Array<{ questionId: string; answer: string }>>([])
  const [code, setCode] = useState('')
  const [recovery, setRecovery] = useState<string[]>([])
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const startSetup = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (answers.length === 0 || answers.some((a) => a.answer.trim().length === 0)) {
      setError('Answer every recovery question to replace your authenticator.')
      return
    }
    setBusy(true)
    try {
      await fetchTotpSetup(answers)
      setStep(2)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start setup.')
    } finally { setBusy(false) }
  }

  const verify = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!totpSetup) { setError('Authenticator setup has not started. Go back and scan the QR code.'); return }
    if (code.length !== 6) { setError('Enter the 6-digit code from your authenticator app.'); return }
    setBusy(true)
    try {
      const codes = await enableTotp(code)
      setRecovery(codes)
      setStep(4)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That code is not valid. Try again, or re-scan the QR code.')
    } finally { setBusy(false) }
  }

  const finish = (e: React.FormEvent) => {
    e.preventDefault()
    if (!saved) { setError('Confirm that you have saved your recovery codes to continue.'); return }
    setError('')
    pushToast('Authenticator enabled', 'success')
    navigate('#/settings/security')
  }

  return (
    <Shell breadcrumb={[{ label: 'Account' }, { label: 'Security' }, { label: 'Authenticator' }]}>
      <div style={{ maxWidth: 640 }}>
        <h2 style={{ fontSize: 18, marginBottom: 4 }}>Set up two-factor authentication</h2>
        <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>Use an authenticator app such as Google Authenticator, Microsoft Authenticator, or 1Password.</p>
        <div className="card">
          {step === 1 && (
            <form className="auth-enroll" style={{ display: 'grid', gap: 12 }} onSubmit={startSetup}>
              <h4 className="mb-8">Step 1 â€” Confirm it's you</h4>
              {error && <div className="danger-box">{error}</div>}
              <p className="muted text-sm">
                Replacing your authenticator is a sensitive action, so confirm your recovery questions first.
              </p>
              <RecoveryAnswers
                onChange={setAnswers}
                submitLabel="Generate new enrollment"
                busy={busy}
                error={error}
                onSubmit={() => undefined}
              />
            </form>
          )}
          {step === 2 && totpSetup && (
            <div className="auth-enroll" style={{ display: 'grid', gap: 12 }}>
              <h4 className="mb-8">Step 2 â€” Add NEXORA to your authenticator app</h4>
              {error && <div className="danger-box">{error}</div>}
              <div style={{ display: 'flex', justifyContent: 'center' }}><RealQr otpauth={totpSetup.otpauth} /></div>
              <div className="hint">Or enter the key manually:</div>
              <div className="mono manual-key" data-testid="totp-manual-key">{groupSecret(totpSetup.secret)}</div>
              <div className="hint">Key: <span className="mono" style={{ fontSize: 12 }}>{totpSetup.secret}</span> Â· Can't scan? <a href={totpSetup.otpauth}>Open in your authenticator app</a>.</div>
              <button className="btn btn-primary btn-block" onClick={() => setStep(3)}>I have scanned the code <I name="arrowRight" size={16} /></button>
              <a className="btn btn-ghost btn-block" href="#/settings/security"><I name="arrowLeft" size={16} /> Back to security</a>
            </div>
          )}
          {step === 3 && (
            <form className="auth-enroll" style={{ display: 'grid', gap: 12 }} onSubmit={verify}>
              <h4 className="mb-8">Step 3 â€” Verify with a code</h4>
              {error && <div className="danger-box">{error}</div>}
              <p className="muted text-sm">Enter the 6-digit code currently shown in your authenticator app.</p>
              <input type="text" inputMode="numeric" maxLength={6} value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000" style={{ fontSize: 18, textAlign: 'center', letterSpacing: '0.2em' }} autoFocus />
              <button className="btn btn-primary btn-block" disabled={busy} type="submit">{busy ? <><span className="spin" /> Verifyingâ€¦</> : 'Verify code'}</button>
              <button className="btn btn-ghost btn-block" type="button" onClick={() => setStep(2)}><I name="arrowLeft" size={16} /> Back to QR code</button>
            </form>
          )}
          {step === 4 && (
            <form className="auth-enroll" style={{ display: 'grid', gap: 12 }} onSubmit={finish}>
              <h4 className="mb-8">Step 4 â€” Save your recovery codes</h4>
              {error && <div className="danger-box">{error}</div>}
              <p className="muted text-sm">If you ever lose your authenticator, you can use one of these one-time codes to get back in. Each code can be used once. They are shown only now.</p>
              <div className="recovery-grid">
                {recovery.map(c => <span key={c} className="mono rc-chip">{c}</span>)}
              </div>
              <label className="row" style={{ gap: 8, alignItems: 'center' }}>
                <input type="checkbox" checked={saved} onChange={e => setSaved(e.target.checked)} />
                <span className="text-sm">I have saved my recovery codes</span>
              </label>
              <button className="btn btn-primary btn-block" type="submit">Finish</button>
            </form>
          )}
        </div>
        <div className="hint mt-16">Recovery codes regenerate each time you re-enable the authenticator.</div>
      </div>
    </Shell>
  )
}
function AuthenticatorManage() {
  const { pushToast, disableTotp, auth } = useStore()
  const [confirming, setConfirming] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [remaining, setRemaining] = useState<number | null>(null)

  useEffect(() => {
    let alive = true
    api.auth.totpStatus()
      .then(s => { if (alive) setRemaining(s.recoveryCodesRemaining) })
      .catch(() => { /* status unavailable */ })
    return () => { alive = false }
  }, [auth.totpEnabled])

  const disable = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (code.length !== 6) { setError('Enter your current code to confirm removal.'); return }
    setBusy(true)
    try {
      await disableTotp(code)
      setConfirming(false); setCode('')
      pushToast('Authenticator disabled', 'info')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid code.')
    } finally { setBusy(false) }
  }

  return (
    <Shell breadcrumb={[{ label: 'Account' }, { label: 'Security' }, { label: 'Authenticator' }]}>
      <div style={{ maxWidth: 640 }}>
        <h2 style={{ fontSize: 18, marginBottom: 4 }}>Two-factor authentication</h2>
        <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>Manage your authenticator app connection.</p>
        <div className="card">
          <div className="row-between mb-12">
            <div className="row" style={{ gap: 10, alignItems: 'center' }}>
              <div className="sec-icon" style={{ background: 'var(--green-50)' }}><I name="checkCircle" size={20} /></div>
              <div>
                <h4 className="mb-4">Authenticator is enabled</h4>
                <div className="muted text-sm">Type: TOTP Â· {remaining === null ? 'â€¦' : `${remaining} unused recovery code${remaining === 1 ? '' : 's'}`}</div>
              </div>
            </div>
            <span className="badge badge-green">On</span>
          </div>
          {!confirming ? (
            <div className="row mt-8" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-danger" onClick={() => setConfirming(true)}>Remove authenticator</button>
            </div>
          ) : (
            <form onSubmit={disable} className="mt-8">
              <p className="text-sm muted">Removing two-factor authentication is a sensitive action. Enter the current code to confirm. After removal you can enroll a fresh authenticator from the setup wizard.</p>
              {error && <div className="danger-box">{error}</div>}
              <div className="field"><label>Current code</label><input type="text" inputMode="numeric" maxLength={6} value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" style={{ letterSpacing: '0.2em' }} autoFocus /></div>
              <div className="row" style={{ gap: 8 }}>
                <button className="btn btn-danger" disabled={busy} type="submit">{busy ? <><span className="spin" /> Removingâ€¦</> : 'Confirm removal'}</button>
                <button className="btn btn-ghost" type="button" onClick={() => setConfirming(false)}>Cancel</button>
              </div>
            </form>
          )}
        </div>
      </div>
    </Shell>
  )
}

export function AuthenticatorPage() {
  const { auth } = useStore()
  return auth.totpEnabled ? <AuthenticatorManage /> : <AuthenticatorSetup />
}
/* ==========================================================================
   Sessions â€” Â§11 Â«Settings â†’ Security â†’ SessionsÂ» (Â§9.7)
   ========================================================================== */

export function Sessions() {
  const { pushToast } = useStore()
  const [rows, setRows] = useState<SessionRow[]>([])
  const [busy, setBusy] = useState(false)
  const [confirmAll, setConfirmAll] = useState(false)

  useEffect(() => {
    authApi.listSessions().then((res: any) => {
      setRows((res.sessions || []).map((s: any) => ({ createdAt: s.createdAt || '', current: !!s.current })))
    }).catch(() => setRows([]))
  }, [])

  const revokeAll = () => {
    if (busy) return
    setBusy(true)
    authApi.revokeOtherSessions().then(() => {
      setRows(cur => cur.filter(r => r.current))
      setConfirmAll(false)
      pushToast('Signed out of all other sessions', 'success')
    }).catch(() => pushToast('Could not revoke sessions', 'error')).finally(() => setBusy(false))
  }

  return (
    <Shell breadcrumb={[{ label: 'Account' }, { label: 'Security' }, { label: 'Sessions' }]}>
      <div style={{ maxWidth: 760 }}>
        <h2 style={{ fontSize: 18, marginBottom: 4 }}>Active sessions</h2>
        <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>Devices where you are signed in to NEXORA.</p>
        {rows.length === 0 ? (
          <div className="card"><div className="empty-note">No active sessions recorded.</div></div>
        ) : (
          <div className="card">
            {rows.map((s, i) => (
              <div key={i} className="session-row">
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <div className="sec-icon"><I name="cpu" size={20} /></div>
                  <div style={{ flex: 1 }}>
                    <div className="row-between">
                      <strong>Signed-in session</strong>
                      {s.current && <span className="badge badge-green">This session</span>}
                    </div>
                    <div className="muted text-sm">Signed in {s.createdAt ? fmtDate(s.createdAt) : 'â€”'}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        {rows.filter(r => !r.current).length > 0 && (
          <div className="mt-16">
            {!confirmAll
              ? <button className="btn btn-danger btn-outline-danger" onClick={() => setConfirmAll(true)}>Sign out of all other sessions</button>
              : (
                <div className="card warn-card">
                  <p className="text-sm">Sign out every other active session? This does not affect your current session.</p>
                  <div className="row mt-8" style={{ gap: 8 }}>
                    <button className="btn btn-danger" onClick={revokeAll} disabled={busy}>{busy ? 'Signing outâ€¦' : 'Sign out all others'}</button>
                    <button className="btn btn-ghost" onClick={() => setConfirmAll(false)}>Cancel</button>
                  </div>
                </div>
              )}
          </div>
        )}
      </div>
    </Shell>
  )
}
/* ==========================================================================
   Security events â€” Â§11 Â«Settings â†’ Security â†’ EventsÂ» (Â§9.7)
   ========================================================================== */

function eventKindOf(kind: string): EventRow['kind'] {
  if (kind.includes('login')) return 'login'
  if (kind.includes('logout')) return 'logout'
  if (kind.includes('password')) return 'password'
  if (kind.includes('authenticator')) return 'authenticator'
  return 'profile'
}

export function Events() {
  const [rows, setRows] = useState<EventRow[]>([])
  const [kind, setKind] = useState<'all' | EventRow['kind']>('all')

  useEffect(() => {
    authApi.listSecurityEvents().then((res: any) => {
      setRows((res.events || []).map((e: any, i: number) => ({
        id: `${i}-${e.kind || 'ev'}`,
        kind: eventKindOf(e.kind || 'profile'),
        time: e.at || '',
        detail: e.detail || '',
        origin: '',
      })))
    }).catch(() => setRows([]))
  }, [])

  const filtered = kind === 'all' ? rows : rows.filter(r => r.kind === kind)
  const kinds: ('all' | EventRow['kind'])[] = ['all', 'login', 'logout', 'password', 'authenticator', 'profile']
  const ic: Record<EventRow['kind'], IconName> = { login: 'logout', logout: 'logout', password: 'key', authenticator: 'shield', profile: 'user' }

  return (
    <Shell breadcrumb={[{ label: 'Account' }, { label: 'Security' }, { label: 'Events' }]}>
      <div style={{ maxWidth: 760 }}>
        <h2 style={{ fontSize: 18, marginBottom: 4 }}>Security events</h2>
        <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>Login, logout, password, and authenticator activity.</p>
        <div className="seg-row" style={{ flexWrap: 'wrap' }}>
          {kinds.map(k => (
            <button key={k} className={`seg ${kind === k ? 'active' : ''}`} onClick={() => setKind(k)}>
              {k === 'all' ? 'All' : k[0].toUpperCase() + k.slice(1)}
            </button>
          ))}
        </div>
        {filtered.length === 0 ? (
          <div className="card"><div className="empty-note">No security events recorded yet.</div></div>
        ) : (
          <div className="card event-table">
            {filtered.map(ev => (
              <div key={ev.id} className="event-row">
                <div className="ev-icon"><I name={ic[ev.kind]} size={16} /></div>
                <div style={{ flex: 1 }}>
                  <div className="row-between">
                    <strong className="text-sm">{ev.kind[0].toUpperCase() + ev.kind.slice(1)}</strong>
                    <span className="muted text-sm">{ev.time ? fmtDateTime(ev.time) : 'â€”'}</span>
                  </div>
                  <div className="muted text-sm">{ev.detail || 'â€”'}</div>
                  {ev.origin && <div className="muted text-sm">{ev.origin}</div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Shell>
  )
}

/* ==========================================================================
   Preferences â€” Â§11 Â«Settings â†’ PreferencesÂ»
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
          {!loaded ? <div className="muted text-sm">Loadingâ€¦</div> : (
            <div style={{ display: 'grid', gap: 12 }}>
              <div className="row-between">
                <div><div>In-app notifications</div><div className="muted text-sm">Show toast and bell notifications in the workspace.</div></div>
                <label className="switch"><input type="checkbox" checked={valueOf('notifications_inApp')} onChange={e => toggle('notifications_inApp', e.target.checked)} disabled={saving} /><span className="track" /></label>
              </div>
              <div className="row-between">
                <div><div>Email notifications</div><div className="muted text-sm">This deployment has no email service; the preference is stored for future environments.</div></div>
                <label className="switch"><input type="checkbox" checked={valueOf('notifications_email')} onChange={e => toggle('notifications_email', e.target.checked)} disabled={saving} /><span className="track" /></label>
              </div>
            </div>
          )}
        </div>
      </div>
    </Shell>
  )
}
