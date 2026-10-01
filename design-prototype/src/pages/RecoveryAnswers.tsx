import React, { useEffect, useState } from 'react'
import { api, type RecoveryQuestion } from '../api'
import { SecretField } from '../components/SecretField'

export interface RecoveryAnswerDraft {
  questionId: string
  answer: string
}

/**
 * Prompts for the account's recovery question/answers.
 *
 * Used to authorize sensitive account changes (password change, authenticator
 * change). The questions come from the backend; the answers are submitted
 * straight back and are never retained in app state beyond the submit, never
 * logged, and never displayed again. This is deliberately NOT part of the
 * ordinary sign-in flow - the authenticator is the login second factor.
 */
export function RecoveryAnswers({
  onChange,
  submitLabel,
  onSubmit,
  busy,
  error,
}: {
  onChange: (answers: RecoveryAnswerDraft[]) => void
  submitLabel: string
  onSubmit: () => void
  busy?: boolean
  error?: string
}) {
  const [questions, setQuestions] = useState<RecoveryQuestion[]>([])
  const [values, setValues] = useState<Record<string, string>>({})
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    let cancelled = false
    void api.auth
      .recoveryInfo()
      .then((res) => {
        if (cancelled) return
        setQuestions(res.questions)
        setLoadError(
          res.configured
            ? ''
            : 'This account has no recovery questions yet. Complete first-time setup first.',
        )
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Could not load recovery questions.')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const setAnswer = (questionId: string, answer: string) => {
    const next = { ...values, [questionId]: answer }
    setValues(next)
    onChange(
      questions.map((q) => ({ questionId: q.id, answer: next[q.id] ?? '' })),
    )
  }

  return (
    <div>
      <div className="field-label" style={{ marginBottom: 6 }}>RECOVERY QUESTIONS</div>
      <p className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
        A password or authenticator change is a sensitive action, so confirm your recovery answers first.
      </p>
      {(loadError || error) && <div className="danger-box">{loadError || error}</div>}
      {questions.length === 0 && !loadError && (
        <p className="muted" style={{ fontSize: 13 }}>Loading your recovery questionsâ€¦</p>
      )}
      {questions.map((q) => (
        <div className="field" key={q.id}>
          <label>{q.question}</label>
          <SecretField
            value={values[q.id] ?? ''}
            onChange={(v) => setAnswer(q.id, v)}
            data-testid={'recovery-verify-' + q.id}
          />
        </div>
      ))}
      <button className="btn btn-primary" disabled={busy || questions.length === 0} onClick={onSubmit} type="button">
        {busy ? <><span className="spin" /> Workingâ€¦</> : submitLabel}
      </button>
    </div>
  )
}

