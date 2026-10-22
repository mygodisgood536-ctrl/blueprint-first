/**
 * FIRST-ENTRY EXPERIENCE (V.6)
 *
 * The public product entry is the application's own root route. Entering there
 * always shows the product's introduction first; the sign-in / sign-up form is
 * only reached by an explicit, deliberate action from that screen.
 *
 *   #/            -> Splash (≈4s)      -> #/welcome
 *   #/welcome     -> Introduction (3 pages: what it is, what is wrong today,
 *                    how this platform solves it) -> #/signin -> the product
 *
 * Two behaviours the amendment requires explicitly:
 *   - the splash runs for approximately four seconds and then transitions on its
 *     own, with a Skip affordance for anyone who does not want to wait;
 *   - onboarding is PERSISTED. A returning user is never forced through it again:
 *     the splash is shown once per browser, and the introduction resumes at the
 *     last page read (or is skipped entirely once completed).
 *
 * This module contains no reference to any privileged or internal role.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { navigate } from '../router'

/** The splash runs for approximately four seconds, per V.6. */
const SPLASH_MS = 4000

const SEEN_KEY = 'bf.onboarding.splashSeen'
const DONE_KEY = 'bf.onboarding.introComplete'
const PAGE_KEY = 'bf.onboarding.introPage'

function readFlag(key: string): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}
function writeFlag(key: string, value: boolean): void {
  if (typeof window === 'undefined') return
  try {
    if (value) window.localStorage.setItem(key, '1')
    else window.localStorage.removeItem(key)
  } catch {
    /* private mode: onboarding simply repeats rather than breaking */
  }
}

function Monogram({ size = 84 }: { size?: number }) {
  return (
    <div
      className="splash-monogram"
      style={{ width: size, height: size, fontSize: size * 0.18 }}
      aria-hidden="true"
    >
      NX
    </div>
  )
}

/**
 * Brand splash. Shows once per browser, advances automatically after ~4s, and
 * can be skipped immediately.
 */
export function Splash() {
  const [progress, setProgress] = useState(0)
  const [leaving, setLeaving] = useState(false)
  const timer = useRef<number | null>(null)
  const started = useRef<number>(0)

  const finish = useCallback(() => {
    writeFlag(SEEN_KEY, true)
    setLeaving(true)
    if (timer.current !== null) window.clearTimeout(timer.current)
    window.setTimeout(() => navigate('#/welcome'), 420)
  }, [])

  useEffect(() => {
    if (readFlag(SEEN_KEY)) {
      // A returning user is not made to watch the splash again.
      navigate('#/welcome')
      return
    }
    started.current = Date.now()
    const tick = window.setInterval(() => {
      const elapsed = Date.now() - started.current
      setProgress(Math.min(100, Math.round((elapsed / SPLASH_MS) * 100)))
    }, 120)
    timer.current = window.setTimeout(finish, SPLASH_MS)
    return () => {
      window.clearInterval(tick)
      if (timer.current !== null) window.clearTimeout(timer.current)
    }
  }, [finish])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === 'Escape' || e.key === ' ') {
        e.preventDefault()
        finish()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [finish])

  return (
    <div
      className="splash-bg"
      style={{ opacity: leaving ? 0 : 1 }}
      role="status"
      aria-live="polite"
      aria-label="Starting NEXORA"
    >
      <div className="grid-backdrop" aria-hidden="true" />
      <div
        className="glow-orb"
        aria-hidden="true"
        style={{ width: 544, height: 544, left: -160, top: -80, background: 'var(--glow-accent)', opacity: 0.5 }}
      />
      <div
        className="glow-orb"
        aria-hidden="true"
        style={{ width: 448, height: 448, right: -128, bottom: -96, background: 'var(--glow-teal)', opacity: 0.4 }}
      />

      <div className="splash-inner">
        <Monogram />
        <div>
          <div className="splash-word">NEXORA</div>
          <div className="splash-strap" style={{ marginTop: '0.75rem' }}>
            Blueprint First AI Engineering
          </div>
        </div>
        <p className="splash-sub">
          An engineering organization that understands software before it is written, verifies every claim
          with evidence, and operates what it ships for life.
        </p>
        <div className="splash-progress" aria-hidden="true">
          <span style={{ width: `${progress}%` }} />
        </div>
        <button type="button" className="btn btn-ghost" onClick={finish}>
          Skip introduction
        </button>
      </div>
    </div>
  )
}

/* --- the introduction ------------------------------------------------------ */

interface IntroPage {
  readonly eyebrow: string
  readonly title: string
  readonly body: string
}

const PAGES: readonly IntroPage[] = [
  {
    eyebrow: 'What this is',
    title: 'Software is engineered, not generated',
    body: 'Most AI coding tools start from a prompt and produce plausible text. This platform starts from your product intent, discovers the complete system that intent actually requires, and only then designs, builds, tests and operates it — through a governed organization where every role is separated from the role that judges its work.',
  },
  {
    eyebrow: 'The problem',
    title: 'What is wrong with the way software is built today',
    body: 'Code is produced faster than anyone can check it. Requirements live in someone’s head. Verification is a test count. Progress is a spinner. And when something breaks, the only record is a log line nobody can audit.',
  },
  {
    eyebrow: 'How this works',
    title: 'Discovery first. Evidence always. Nothing self-certified.',
    body: 'A discovery department of thirty-six specialized roles expands your intent into a certified inventory of modules, features, pages, actions, states, permissions, APIs and entities. A boss reconstructs that inventory independently and diffs it by artifact ID. Only then does anything get designed, built, tested, deployed and operated for life.',
  },
]

/** The product's first-entry welcome and introduction (three pages, no more). */
export function Welcome() {
  const [page, setPage] = useState(0)
  const [done, setDone] = useState(() => readFlag(DONE_KEY))
  const introRef = useRef<HTMLDivElement | null>(null)

  /* Onboarding is persisted: once the introduction has been seen through (or
     skipped), a returning user goes straight to the form instead of being made
     to repeat it. */
  useEffect(() => {
    if (readFlag(DONE_KEY)) navigate('#/signin')
  }, [])

  useEffect(() => {
    const stored = Number(window.localStorage?.getItem(PAGE_KEY) ?? '0')
    if (Number.isInteger(stored) && stored >= 0 && stored < PAGES.length) setPage(stored)
  }, [])

  useEffect(() => {
    try {
      window.localStorage?.setItem(PAGE_KEY, String(page))
    } catch {
      /* ignore */
    }
  }, [page])

  const complete = useCallback(() => {
    writeFlag(DONE_KEY, true)
    navigate('#/signin')
  }, [])

  const current = PAGES[Math.min(page, PAGES.length - 1)]!
  const last = page === PAGES.length - 1

  return (
    <div className="auth-bg">
      <div className="grid-backdrop" aria-hidden="true" />
      <div
        className="glow-orb"
        aria-hidden="true"
        style={{ width: 416, height: 416, left: -144, top: -112, background: 'var(--glow-accent)', opacity: 0.45 }}
      />
      <div
        className="glow-orb"
        aria-hidden="true"
        style={{ width: 352, height: 352, right: -112, bottom: -96, background: 'var(--glow-teal)', opacity: 0.35 }}
      />

      <div className="auth-wide" ref={introRef}>
        <div className="welcome-head">
          <a className="entry-mark" href="#/" aria-label="NEXORA home">
            <Monogram size={44} />
            <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
              <span className="brand-name">NEXORA</span>
              <span className="brand-sub">Blueprint First AI Engineering</span>
            </span>
          </a>
        </div>

        <div className="auth-card">
          <div className="row-between" style={{ marginBottom: '1.25rem' }}>
            <p className="eyebrow accent">
              <span className="dim" style={{ marginRight: '0.6rem' }}>
                —
              </span>
              {current.eyebrow}
            </p>
            <div className="intro-dots" role="tablist" aria-label="Introduction pages">
              {PAGES.map((p, i) => (
                <button
                  key={p.title}
                  type="button"
                  role="tab"
                  className="intro-dot"
                  aria-current={i === page}
                  aria-label={`Page ${i + 1}: ${p.eyebrow}`}
                  onClick={() => setPage(i)}
                />
              ))}
            </div>
          </div>

          <div className="intro-step" key={page}>
            <h2 className="display-md">{current.title}</h2>
            <p>{current.body}</p>

            {page === 0 && (
              <ul className="intro-list">
                <li>
                  <span className="intro-num">01</span>
                  <span>
                    <div className="intro-title">Discovery before design</div>
                    <div className="intro-desc">
                      Thirty-six specialized roles expand your intent into a complete, traceable product
                      inventory — including what you did not think to ask for.
                    </div>
                  </span>
                </li>
                <li>
                  <span className="intro-num">02</span>
                  <span>
                    <div className="intro-title">Judgement separated from production</div>
                    <div className="intro-desc">
                      Workers produce, verifiers judge, bosses independently reconstruct, auditors inspect.
                      Nothing is certified by whoever built it.
                    </div>
                  </span>
                </li>
              </ul>
            )}

            {page === 1 && (
              <div className="compare" style={{ marginTop: '1.35rem' }}>
                <div className="bad">
                  <h3>Today</h3>
                  <ul>
                    <li>
                      <span className="mark">✕</span>
                      <span>Code produced faster than anyone can check it</span>
                    </li>
                    <li>
                      <span className="mark">✕</span>
                      <span>Requirements living in someone’s head</span>
                    </li>
                    <li>
                      <span className="mark">✕</span>
                      <span>“Tests pass” used as proof of correctness</span>
                    </li>
                    <li>
                      <span className="mark">✕</span>
                      <span>Progress shown as a spinner rather than evidence</span>
                    </li>
                  </ul>
                </div>
                <div className="good">
                  <h3>Here</h3>
                  <ul>
                    <li>
                      <span className="mark">✓</span>
                      <span>Every claim backed by inspectable evidence</span>
                    </li>
                    <li>
                      <span className="mark">✓</span>
                      <span>Requirements traced from intent to production by ID</span>
                    </li>
                    <li>
                      <span className="mark">✓</span>
                      <span>Eleven verification dimensions at every stage</span>
                    </li>
                    <li>
                      <span className="mark">✓</span>
                      <span>Progress that is a projection of persisted state</span>
                    </li>
                  </ul>
                </div>
              </div>
            )}

            {page === 2 && (
              <ul className="intro-list">
                <li>
                  <span className="intro-num">01</span>
                  <span>
                    <div className="intro-title">Discover</div>
                    <div className="intro-desc">
                      Twenty-five ordered passes, a boss that reconstructs independently, a red team, and a
                      contradiction register that must reach zero before anything moves on.
                    </div>
                  </span>
                </li>
                <li>
                  <span className="intro-num">02</span>
                  <span>
                    <div className="intro-title">Design, build and test against that contract</div>
                    <div className="intro-desc">
                      Design answers to Discovery. Build answers to Design. Test coverage is derived
                      mechanically from the certified inventory, never from opinion.
                    </div>
                  </span>
                </li>
                <li>
                  <span className="intro-num">03</span>
                  <span>
                    <div className="intro-title">Operate for life</div>
                    <div className="intro-desc">
                      Deployment verification, continuous operations, drift detection, safe change, and
                      engineering memory that keeps every certified state.
                    </div>
                  </span>
                </li>
              </ul>
            )}
          </div>

          <div className="intro-actions">
            <button type="button" className="btn btn-ghost" onClick={complete}>
              Skip
            </button>
            <div className="btn-group">
              {page > 0 && (
                <button type="button" className="btn btn-outline" onClick={() => setPage((p) => Math.max(0, p - 1))}>
                  Back
                </button>
              )}
              {last ? (
                <button type="button" className="btn btn-primary" onClick={complete}>
                  Create an account
                </button>
              ) : (
                <button type="button" className="btn btn-primary" onClick={() => setPage((p) => p + 1)}>
                  Next
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="welcome-points" style={{ marginTop: '1.25rem' }}>
          <div>
            <strong>Real execution</strong>
            <span>Work runs for real, in an isolated environment, and the results are recorded — not simulated.</span>
          </div>
          <div>
            <strong>One provider, one model</strong>
            <span>Your project’s verified configuration is used everywhere, with no silent substitution.</span>
          </div>
          <div>
            <strong>Evidence, not narration</strong>
            <span>A count is a symptom. Every certification is backed by inspectable proof.</span>
          </div>
        </div>

        <p className="center text-sm dim" style={{ marginTop: '1.5rem' }}>
          {done ? 'Welcome back — ' : ''}
          <a href="#/signin">Sign in</a>
        </p>
      </div>
    </div>
  )
}