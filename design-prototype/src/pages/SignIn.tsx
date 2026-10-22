/**
 * SIGN IN / CREATE ACCOUNT - the one public authentication entry.
 *
 * Reached deliberately from the product welcome screen. Contains no reference
 * to any privileged role, no owner link, and no internal terminology.
 *
 * The credential model is deliberately minimal and is the ONLY one in the
 * product:
 *
 *   CREATE ACCOUNT : Full Name, Username, Gmail, Security Question, Answer
 *   SIGN IN        : Gmail, Security Question, Answer
 *
 * There is no password, OTP, SMS or email verification, authenticator,
 * recovery-code or password-reset field anywhere on this screen, and no link to
 * any of those flows. The privileged account is not created or signed in here
 * either: it is provisioned server-side and then signs in through this exact
 * screen, like any other account.
 */
import React, { useState } from 'react'
import { navigate } from '../router'
import { useStore } from '../store'

function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-bg">
      <div className="grid-backdrop" aria-hidden="true" />
      <div
        className="glow-orb"
        aria-hidden="true"
        style={{ width: 416, height: 416, left: -144, top: -96, background: 'var(--glow-accent)', opacity: 0.5 }}
      />
      <div
        className="glow-orb"
        aria-hidden="true"
        style={{ width: 320, height: 320, right: -112, bottom: -88, background: 'var(--glow-teal)', opacity: 0.4 }}
      />
      <div className="auth-card-wrap">
        <div className="auth-brand">
          <a href="#/welcome" className="entry-mark" aria-label="NEXORA home">
            <span className="splash-monogram" style={{ width: 40, height: 40, fontSize: 13 }} aria-hidden="true">
              NX
            </span>
            <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
              <span className="brand-name">NEXORA</span>
              <span className="brand-sub">Blueprint First AI Engineering</span>
            </span>
          </a>
        </div>
        <div className="auth-card">{children}</div>
        <p className="center text-sm dim" style={{ marginTop: '1.5rem' }}>
          &copy; 2026 NEXORA
        </p>
      </div>
    </div>
  )
}

function Notice({ tone, children }: { tone: 'error' | 'info' | 'success'; children: React.ReactNode }) {
  const cls = tone === 'error' ? 'notice-error' : tone === 'success' ? 'notice-success' : 'notice-info'
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`notice ${cls}`}>
      {children}
    </div>
  )
}

/** The security-question picker. The catalog is public and fetched from the server. */
function QuestionSelect({
  value,
  onChange,
  id,
}: {
  value: string
  onChange: (v: string) => void
  id: string
}) {
  const { securityQuestions, loadSecurityQuestions } = useStore()
  React.useEffect(() => {
    if (securityQuestions.length === 0) void loadSecurityQuestions()
  }, [securityQuestions.length, loadSecurityQuestions])
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} required>
      <option value="">Choose a security question…</option>
      {securityQuestions.map(q => (
        <option key={q} value={q}>
          {q}
        </option>
      ))}
    </select>
  )
}

export function SignIn() {
  const store = useStore()
  const [mode, setMode] = useState<'signin' | 'create'>('signin')

  // Sign in: exactly three fields.
  const [gmail, setGmail] = useState('')
  const [signinQuestion, setSigninQuestion] = useState('')
  const [signinAnswer, setSigninAnswer] = useState('')

  // Create account: exactly five fields.
  const [fullName, setFullName] = useState('')
  const [username, setUsername] = useState('')
  const [createGmail, setCreateGmail] = useState('')
  const [createQuestion, setCreateQuestion] = useState('')
  const [createAnswer, setCreateAnswer] = useState('')

  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const creating = mode === 'create'

  // An already signed-in account never needs this screen.
  React.useEffect(() => {
    if (store.auth.authenticated) navigate('#/dashboard')
  }, [store.auth.authenticated])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (creating) {
      if (fullName.trim().length < 2) { setError('Enter your full name.'); return }
      if (username.trim().length < 3) { setError('Username must be at least 3 characters.'); return }
      if (!createGmail.trim()) { setError('Enter your Gmail address.'); return }
      if (!createQuestion) { setError('Choose a security question.'); return }
      if (createAnswer.trim().length < 2) { setError('Enter the answer to your security question.'); return }
      setBusy(true)
      const res = await store.signup({
        fullName, username, gmail: createGmail,
        securityQuestion: createQuestion, securityAnswer: createAnswer,
      })
      setBusy(false)
      if (res.ok) {
        // Sign-up issues no session, so we switch to the sign-in form with the
        // details carried across rather than pretending the account is active.
        setGmail(createGmail)
        setSigninQuestion(createQuestion)
        setMode('signin')
        setError('Account created. Sign in with your Gmail and security question.')
      } else {
        setError(res.reason)
      }
      return
    }

    if (!gmail.trim()) { setError('Enter your Gmail address.'); return }
    if (!signinQuestion) { setError('Choose your security question.'); return }
    if (!signinAnswer.trim()) { setError('Enter the answer to your security question.'); return }
    setBusy(true)
    const res = await store.login({ gmail, securityQuestion: signinQuestion, securityAnswer: signinAnswer })
    setBusy(false)
    if (res.ok) {
      navigate('#/dashboard')
    } else {
      // One generic message for every failure: an unknown Gmail, a wrong
      // question and a wrong answer are indistinguishable.
      setError('Those details did not match an account.')
    }
  }
return (
    <AuthShell>
      <h1 className="auth-title">{creating ? 'Create your account' : 'Sign in'}</h1>
      <p className="muted text-sm auth-sub">
        {creating
          ? 'Five details create your account. You will sign in with your Gmail and security question.'
          : 'Sign in with your Gmail address and the security question you chose.'}
      </p>
      <form onSubmit={submit} noValidate>
        {error && <Notice tone="error">{error}</Notice>}

        {creating && (
          <div className="field">
            <label htmlFor="full-name">Full Name</label>
            <input
              id="full-name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Your full name"
              autoComplete="name"
              data-testid="auth-fullname"
            />
          </div>
        )}

        {creating && (
          <div className="field">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Choose a username"
              autoComplete="username"
              data-testid="auth-username"
            />
          </div>
        )}

        <div className="field">
          <label htmlFor="gmail">Gmail</label>
          <input
            id="gmail"
            type="email"
            value={creating ? createGmail : gmail}
            onChange={(e) => (creating ? setCreateGmail(e.target.value) : setGmail(e.target.value))}
            placeholder="you@gmail.com"
            autoComplete="email"
            data-testid="auth-gmail"
          />
        </div>

        <div className="field">
          <label htmlFor="security-question">Security Question</label>
          <QuestionSelect
            id="security-question"
            value={creating ? createQuestion : signinQuestion}
            onChange={(v) => (creating ? setCreateQuestion(v) : setSigninQuestion(v))}
          />
        </div>

        <div className="field">
          <label htmlFor="security-answer">Security Answer</label>
          <input
            id="security-answer"
            value={creating ? createAnswer : signinAnswer}
            onChange={(e) => (creating ? setCreateAnswer(e.target.value) : setSigninAnswer(e.target.value))}
            placeholder="Answer from memory"
            autoComplete="off"
            data-testid="auth-answer"
          />
        </div>

        <button className="btn btn-primary btn-block btn-lg" disabled={busy} type="submit">
          {busy ? 'Working…' : creating ? 'Create account' : 'Sign in'}
        </button>
      </form>
      <div className="divider" />
      <p className="auth-switch text-sm muted">
        {creating ? 'Already have an account? ' : 'New to NEXORA? '}
        <a
          href="#/signin"
          onClick={(e) => {
            e.preventDefault()
            setMode(creating ? 'signin' : 'create')
            setError('')
          }}
        >
          {creating ? 'Sign in instead' : 'Create an account'}
        </a>
      </p>
    </AuthShell>
  )
}
