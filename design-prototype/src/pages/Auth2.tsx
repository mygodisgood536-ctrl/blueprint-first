import React, { useState } from 'react'
import { navigate } from '../router'
import { api, type RecoveryQuestion } from '../api'
import { SecretField } from '../components/SecretField'

function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-bg">
      <div style={{ width: '100%', maxWidth: 460 }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <a href="#/welcome" style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
            <img src="/favicon.svg" alt="" width={36} height={36} />
            <span style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)' }}>NEXORA</span>
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

function Banner({
  tone,
  children,
}: {
  tone: 'error' | 'info' | 'success'
  children: React.ReactNode
}) {
  const bg = tone === 'error' ? 'var(--danger-soft)' : tone === 'success' ? 'var(--success-soft)' : 'var(--info-soft)'
  const fg = tone === 'error' ? 'var(--danger)' : tone === 'success' ? 'var(--success)' : 'var(--info)'
  return (
    <div style={{ padding: '10px 14px', borderRadius: 8, background: bg, color: fg, fontSize: 13, marginBottom: 16 }}>
      {children}
    </div>
  )
}

/**
 * FORGOT PASSWORD: username -> recovery questions -> new password.
 *
 * The recovery questions are the recovery authority. They are NOT used to sign
 * in - the authenticator remains mandatory for ordinary login - and they are not
 * requested anywhere else in the login flow.
 */
export function Forgot() {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [username, setUsername] = useState('')
  const [challengeId, setChallengeId] = useState('')
  const [questions, setQuestions] = useState<RecoveryQuestion[]>([])
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [resetToken, setResetToken] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  const handleRequest = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username.trim()) {
      setError('Enter your username.')
      return
    }
    setError('')
    setLoading(true)
    try {
      const res = await api.auth.forgot(username.trim())
      setChallengeId(res.challengeId)
      setQuestions(res.questions)
      setAnswers({})
      setStep(2)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Recovery is not available for that account.')
    } finally {
      setLoading(false)
    }
  }

  const handleAnswer = async (e: React.FormEvent) => {
    e.preventDefault()
    const list = questions.map((q) => ({ questionId: q.id, answer: answers[q.id] ?? '' }))
    if (list.some((a) => a.answer.trim().length === 0)) {
      setError('Answer every recovery question.')
      return
    }
    setError('')
    setLoading(true)
    try {
      const res = await api.auth.forgotAnswer(challengeId, list)
      setResetToken(res.resetToken)
      setNotice(res.notice ?? '')
      setStep(3)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'The recovery answers are not correct.')
    } finally {
      setLoading(false)
    }
  }

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault()
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (newPassword !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setError('')
    setLoading(true)
    try {
      await api.auth.reset(resetToken, newPassword)
      setSuccess(true)
      setTimeout(() => navigate('#/signin'), 1500)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Reset failed. The token may have expired.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout>
      <h2 style={{ fontSize: 22, marginBottom: 4 }}>Reset password</h2>
      <p className="muted text-sm mb-16">
        {step === 1 && 'Identify your account to begin recovery.'}
        {step === 2 && 'Answer your recovery questions to continue.'}
        {step === 3 && 'Choose a new password.'}
      </p>
      {success && <Banner tone="success">Password reset successfully. Redirectingâ€¦</Banner>}
      {error && <Banner tone="error">{error}</Banner>}
      {notice && !success && <Banner tone="info">{notice}</Banner>}

      {step === 1 && (
        <form onSubmit={handleRequest}>
          <div className="field">
            <label>Username</label>
            <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="your-username" autoFocus />
          </div>
          <button className="btn btn-primary btn-block" type="submit" disabled={loading}>
            {loading ? 'Checkingâ€¦' : 'Continue'}
          </button>
        </form>
      )}

      {step === 2 && (
        <form onSubmit={handleAnswer}>
          {questions.map((q) => (
            <div className="field" key={q.id}>
              <label>{q.question}</label>
              <SecretField
                value={answers[q.id] ?? ''}
                onChange={(v) => setAnswers((prev) => ({ ...prev, [q.id]: v }))}
                data-testid={`forgot-answer-${q.id}`}
              />
            </div>
          ))}
          <button className="btn btn-primary btn-block" type="submit" disabled={loading}>
            {loading ? 'Checkingâ€¦' : 'Verify answers'}
          </button>
        </form>
      )}

      {step === 3 && (
        <form onSubmit={handleReset}>
          <div className="field">
            <label>Reset token</label>
            <input
              value={resetToken}
              readOnly
              style={{ fontFamily: 'monospace', fontSize: 12, background: 'var(--bg-secondary)' }}
            />
          </div>
          <div className="field">
            <label>New password</label>
            <SecretField
              value={newPassword}
              onChange={setNewPassword}
              autoFocus
              autoComplete="new-password"
              data-testid="forgot-new-password"
            />
          </div>
          <div className="field">
            <label>Confirm password</label>
            <SecretField
              value={confirm}
              onChange={setConfirm}
              autoComplete="new-password"
              data-testid="forgot-confirm-password"
            />
          </div>
          <button className="btn btn-primary btn-block" type="submit" disabled={loading}>
            {loading ? 'Savingâ€¦' : 'Set new password'}
          </button>
        </form>
      )}

      <div className="divider" />
      <p className="center text-sm">
        <a href="#/signin">&larr; Back to sign in</a>
      </p>
    </AuthLayout>
  )
}




