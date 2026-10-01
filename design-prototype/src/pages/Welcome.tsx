/**
 * FIRST-ENTRY EXPERIENCE
 *
 * The public product entry is `http://<host>/#/` - the application's own root
 * route, with no role wording in the URL. Entering there always shows the
 * product's welcome experience first; the sign-in / sign-up form is only reached
 * by an explicit, deliberate action from that screen.
 *
 * Flow:
 *   #/  -> Splash (brand) -> #/welcome (product welcome)
 *        -> #/signin (sign in, or create an account)
 *        -> #/setup/recovery -> #/setup/authenticator -> #/dashboard
 *
 * This module deliberately contains NO reference to any privileged or internal
 * role. The private owner entry lives in a separate module and is never linked
 * from here.
 */
import React, { useEffect, useState } from 'react'
import { navigate } from '../router'

/** Brand splash. Auto-advances to the product welcome; also skippable. */
export function Splash() {
  const [fading, setFading] = useState(false)
  useEffect(() => {
    const fade = setTimeout(() => setFading(true), 2200)
    const go = setTimeout(() => navigate('#/welcome'), 2900)
    return () => {
      clearTimeout(fade)
      clearTimeout(go)
    }
  }, [])
  return (
    <div
      className="splash-bg"
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: 20,
        transition: 'opacity 700ms ease',
        opacity: fading ? 0 : 1,
        color: 'var(--text-primary)',
      }}
    >
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div
          style={{
            position: 'absolute',
            width: 150,
            height: 150,
            borderRadius: '50%',
            background:
              'radial-gradient(circle, rgba(16,185,129,0.15) 0%, rgba(52,211,153,0.06) 45%, transparent 70%)',
            filter: 'blur(6px)',
          }}
        />
        <img src="/favicon.svg" alt="" style={{ width: 68, height: 68, position: 'relative' }} />
      </div>
      <div style={{ textAlign: 'center' }}>
        <div
          style={{
            color: 'var(--text-primary)',
            fontSize: 38,
            fontWeight: 900,
            letterSpacing: '-0.02em',
          }}
        >
          NEXORA
        </div>
        <div
          style={{
            color: 'var(--text-secondary)',
            fontSize: 14.5,
            fontWeight: 500,
            marginTop: 8,
            letterSpacing: '0.01em',
          }}
        >
          The Blueprint AI Software Engineering Platform
        </div>
      </div>
      <button
        type="button"
        className="btn btn-ghost"
        style={{ marginTop: 12 }}
        onClick={() => navigate('#/welcome')}
      >
        Continue
      </button>
    </div>
  )
}

function Wordmark() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <img src="/favicon.svg" alt="" width={32} height={32} />
      <span style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)' }}>NEXORA</span>
    </div>
  )
}

/**
 * The product's first-entry welcome screen. Explains the product and offers a
 * clear primary action. It never implies that any other sign-up path exists.
 */
export function Welcome() {
  return (
    <div className="auth-bg">
      <div style={{ width: '100%', maxWidth: 520 }}>
        <div style={{ textAlign: 'center', marginBottom: 22 }}>
          <a href="#/" style={{ display: 'inline-flex' }}>
            <Wordmark />
          </a>
        </div>
        <div className="auth-card card" style={{ padding: 28 }}>
          <h1 style={{ fontSize: 24, marginBottom: 8, letterSpacing: '-0.01em' }}>
            Ship software from a blueprint
          </h1>
          <p className="muted text-sm mb-24" style={{ lineHeight: 1.6 }}>
            NEXORA turns a product vision into a governed engineering plan, then executes it in a real
            environment with evidence behind every step. Start a workspace, or sign back in to continue where
            you left off.
          </p>
          <a className="btn btn-primary btn-block btn-lg" href="#/signin">
            Get started
          </a>
          <p className="center text-sm muted mt-16" style={{ marginBottom: 0 }}>
            Setting up an account takes a minute. You will add a recovery question and an authenticator app
            for a secure sign-in.
          </p>
        </div>
        <div className="welcome-points">
          <div>
            <strong>Plan first</strong>
            <span>Every project starts as an explicit, reviewable blueprint.</span>
          </div>
          <div>
            <strong>Execute for real</strong>
            <span>Work runs in a real environment and the results are recorded.</span>
          </div>
          <div>
            <strong>Prove it</strong>
            <span>Verification evidence is attached to the artifacts it supports.</span>
          </div>
        </div>
        <p className="center text-sm mt-24">
          <a href="#/how">How NEXORA works</a>
        </p>
      </div>
    </div>
  )
}
