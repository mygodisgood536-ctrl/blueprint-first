/**
 * FIRST-TIME ACCOUNT SETUP
 *
 * Two mandatory steps, in this order, for every new account:
 *   1. Recovery questions and answers  ->  #/setup/recovery
 *   2. Authenticator setup and a verified 6-digit code -> #/setup/authenticator
 *
 * Neither step can be skipped: the backend answers 403 on every product route
 * until both are complete, and this router follows the same order.
 *
 * The authenticator secret is fetched EXACTLY ONCE per mount. An earlier
 * version re-ran the effect on every render of the store context, which
 * regenerated the secret and made the field flicker. The effect now depends only
 * on the stable callback, and a ref guards against a second request.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { navigate } from '../router'
import { api, type RecoveryQuestion } from '../api'
import { useStore } from '../store'
import { SecretDisplay, SecretField } from '../components/SecretField'

function SetupShell({
  step,
  title,
  subtitle,
  children,
}: {
  step: string
  title: string
  subtitle: string
  children: React.ReactNode
}) {
  return (
    <div className="auth-bg">
      <div style={{ width: '100%', maxWidth: 520 }}>
        <div style={{ textAlign: 'center', marginBottom: 22 }}>
          <a href="#/welcome" style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
            <img src="/favicon.svg" alt="" width={32} height={32} />
            <span style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)' }}>NEXORA</span>
          </a>
        </div>
        <div className="auth-card card">
          <div className="setup-step">{step}</div>
          <h1 style={{ fontSize: 21, marginBottom: 4 }}>{title}</h1>
          <p className="muted text-sm mb-20">{subtitle}</p>
          {children}
        </div>
        <p className="center text-sm mt-16" style={{ color: 'var(--text-tertiary)' }}>
          These two steps secure your account. They are required before you can continue.
        </p>
      </div>
    </div>
  )
}

function Notice({ tone, children }: { tone: 'error' | 'info'; children: React.ReactNode }) {
  const bg = tone === 'error' ? 'var(--danger-soft)' : 'var(--info-soft)'
  const fg = tone === 'error' ? 'var(--danger)' : 'var(--info)'
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
 * Where the account currently stands, so a refresh never strands the user.
 *
 * `suppressComplete` is used by the authenticator step: when the 6-digit code
 * verifies, the one-time recovery codes are shown EXACTLY ONCE. An automatic
 * redirect on completion would navigate past that screen and the user would
 * never be able to save them, so the redirect is suppressed while they are on
 * screen and the user leaves deliberately.
 */
function useSetupRedirect(suppressComplete = false): { authenticated: boolean; stage: string; complete: boolean } {
  const store = useStore()
  const state = {
    authenticated: store.auth.authenticated,
    stage: store.auth.setupStage,
    complete: store.auth.setupComplete,
  }
  useEffect(() => {
    if (!state.authenticated) {
      navigate('#/signin')
      return
    }
    if (state.complete) {
      // Setup always completes into the product. The wizard is role-neutral: it
      // never routes anyone into the private administration area on its own.
      if (!suppressComplete) navigate('#/dashboard')
      return
    }
    if (state.stage === 'recovery') navigate('#/setup/recovery')
  }, [state.authenticated, state.complete, state.stage, suppressComplete])
  return state
}

/**
 * STEP 1 of 2: recovery questions and answers.
 *
 * Answers are transmitted once and hashed by the backend. They are never
 * displayed again, never returned by an API, and never logged.
 */
export function RecoverySetup() {
  const store = useStore()
  const { stage } = useSetupRedirect()
  const [catalog, setCatalog] = useState<RecoveryQuestion[]>([])
  const [rows, setRows] = useState<Array<{ questionId: string; answer: string; confirm: string }>>([
    { questionId: '', answer: '', confirm: '' },
  ])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (stage !== 'recovery') return
    let cancelled = false
    void api.auth
      .recoveryCatalog()
      .then((res) => {
        if (!cancelled) setCatalog(res.questions)
      })
      .catch(() => {
        if (!cancelled) setError('We could not load the recovery questions. Refresh to try again.')
      })
    return () => {
      cancelled = true
    }
  }, [stage])

  const setRow = (index: number, patch: Partial<{ questionId: string; answer: string; confirm: string }>) => {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const filled = rows.filter((r) => r.questionId !== '' || r.answer.trim().length > 0)
    if (filled.length === 0) {
      setError('Choose a recovery question and enter an answer.')
      return
    }
    if (filled.some((r) => r.answer.trim() !== r.confirm.trim())) {
      setError('The answers you entered do not match.')
      return
    }
    const answers = filled.map((r) => ({ questionId: r.questionId, answer: r.answer.trim() }))
    if (answers.some((a) => a.answer.length < 3)) {
      setError('Each answer must be at least 3 characters.')
      return
    }
    if (new Set(answers.map((a) => a.questionId)).size !== answers.length) {
      setError('Each recovery question may only be used once.')
      return
    }
    setError('')
    setBusy(true)
    const res = await store.setupRecoveryQuestions(answers)
    setBusy(false)
    if (res.ok) {
      navigate('#/setup/authenticator')
    } else {
      setError(res.reason || 'We could not save your recovery answers.')
    }
  }

  return (
    <SetupShell
      step="Step 1 of 2"
      title="Set up account recovery"
      subtitle="These answers let you recover access and confirm sensitive changes. They are never used to sign in."
    >
      <form onSubmit={submit} noValidate>
        {error && <Notice tone="error">{error}</Notice>}
        {rows.map((row, index) => {
          const usedElsewhere = rows.some((r, i) => i !== index && r.questionId === row.questionId)
          return (
            <fieldset key={index} className="recovery-row">
              <legend className="recovery-legend">Question {index + 1}</legend>
              <div className="field">
                <label htmlFor={`rq-${index}`}>Recovery question</label>
                <select
                  id={`rq-${index}`}
                  value={row.questionId}
                  onChange={(e) => setRow(index, { questionId: e.target.value })}
                >
                  <option value="">Choose a question…</option>
                  {catalog
                    .filter((q) => !rows.some((r, i) => i !== index && r.questionId === q.id))
                    .map((q) => (
                      <option key={q.id} value={q.id}>
                        {q.question}
                      </option>
                    ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor={`ra-${index}`}>Your answer</label>
                <SecretField
                  value={row.answer}
                  onChange={(v) => setRow(index, { answer: v })}
                  placeholder="Stored securely — never shown again"
                  data-testid={`recovery-answer-${index}`}
                />
              </div>
              <div className="field">
                <label htmlFor={`rc-${index}`}>Confirm answer</label>
                <SecretField
                  value={row.confirm}
                  onChange={(v) => setRow(index, { confirm: v })}
                  placeholder="Re-enter your answer"
                  data-testid={`recovery-confirm-${index}`}
                />
              </div>
              {rows.length > 1 && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setRows((prev) => prev.filter((_, i) => i !== index))}
                >
                  Remove question {index + 1}
                </button>
              )}
              {usedElsewhere && null}
            </fieldset>
          )
        })}
        {rows.length < 3 && (
          <button
            type="button"
            className="btn btn-ghost btn-block mb-16"
            onClick={() => setRows((prev) => [...prev, { questionId: '', answer: '', confirm: '' }])}
          >
            Add another recovery question
          </button>
        )}
        <button className="btn btn-primary btn-block btn-lg" disabled={busy} type="submit">
          {busy ? 'Saving…' : 'Save and continue'}
        </button>
        <p className="muted text-sm mt-16" style={{ marginBottom: 0 }}>
          Answers are hashed before they are stored, and are never shown to you again.
        </p>
      </form>
    </SetupShell>
  )
}

/**
 * STEP 2 of 2: authenticator setup and verification.
 *
 * The secret shown is the secret the backend generated and stored. The same
 * value is used to build the provisioning URI, so a scanned QR code and the
 * displayed key are always the same authenticator. The account becomes usable
 * only after a live 6-digit code verifies.
 */
export function AuthenticatorSetup() {
  const store = useStore()
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null)
  // While the one-time recovery codes are on screen, never auto-navigate away.
  const { stage } = useSetupRedirect(recoveryCodes !== null)
  const [secret, setSecret] = useState('')
  const [otpauth, setOtpauth] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const requested = useRef(false)

  // The store's `fetchTotpSetup` is a stable useCallback. Depending on the whole
  // context object here would re-run this effect on every render, request a new
  // secret each time, and make the field flicker. The ref makes it exactly once.
  const startSetup = store.fetchTotpSetup
  useEffect(() => {
    if (stage !== 'authenticator') return
    if (requested.current) return
    requested.current = true
    setLoading(true)
    void startSetup()
      .catch((err: unknown) => {
        requested.current = false
        setError(err instanceof Error ? err.message : 'We could not start authenticator setup.')
      })
      .finally(() => {
        setLoading(false)
      })
  }, [stage, startSetup])

  // Read the issued secret from the store exactly once it exists.
  useEffect(() => {
    if (store.totpSetup === null) return
    setSecret(store.totpSetup.secret)
    setOtpauth(store.totpSetup.otpauth)
  }, [store.totpSetup])

  const submit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      const digits = code.replace(/\D/g, '')
      if (digits.length !== 6) {
        setError('Enter the 6-digit code from your authenticator app.')
        return
      }
      setError('')
      setLoading(true)
      try {
        const codes = await store.enableTotp(digits)
        setRecoveryCodes(codes)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'That code was not accepted. Try the next code.')
      } finally {
        setLoading(false)
      }
    },
    [code, store],
  )

  if (recoveryCodes !== null) {
    return (
      <SetupShell
        step="Setup complete"
        title="Your account is ready"
        subtitle="Save these one-time recovery codes. Each one works once, and they are shown only now."
      >
        <ul className="code-list">
          {recoveryCodes.map((c) => (
            <li key={c}>
              <code>{c}</code>
            </li>
          ))}
        </ul>
        <button className="btn btn-primary btn-block btn-lg" onClick={() => navigate('#/dashboard')}>
          Continue to workspace
        </button>
      </SetupShell>
    )
  }

  return (
    <SetupShell
      step="Step 2 of 2"
      title="Add an authenticator app"
      subtitle="Use Google Authenticator, Authy, 1Password, or any TOTP app. You will enter its 6-digit code to confirm."
    >
      <form onSubmit={submit} noValidate>
        {error && <Notice tone="error">{error}</Notice>}

        <div className="field">
          <label>Setup key</label>
          {secret.length > 0 ? (
            <SecretDisplay value={secret} data-testid="authenticator-secret" />
          ) : (
            <div className="secret-display-value mono" data-testid="authenticator-secret-loading">
              {loading ? 'Generating…' : 'Preparing…'}
            </div>
          )}
          <p className="muted text-sm mt-8" style={{ marginBottom: 0 }}>
            Add it manually, or{' '}
            {otpauth.length > 0 ? (
              <a href={otpauth}>open it directly in your authenticator app</a>
            ) : (
              'scan it once your app is ready'
            )}
            . The key above and the link use the same secret.
          </p>
        </div>

        <div className="field">
          <label htmlFor="setup-code">6-digit code</label>
          <input
            id="setup-code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            style={{ letterSpacing: '0.4em', fontSize: 20, textAlign: 'center' }}
            data-testid="setup-code"
          />
        </div>

        <button
          className="btn btn-primary btn-block btn-lg"
          disabled={loading || secret.length === 0}
          type="submit"
        >
          {loading ? 'Verifying…' : 'Verify and finish'}
        </button>
        <p className="muted text-sm mt-16" style={{ marginBottom: 0 }}>
          Your account activates only after this code is accepted. You will use the app to sign in from now on.
        </p>
      </form>
    </SetupShell>
  )
}
