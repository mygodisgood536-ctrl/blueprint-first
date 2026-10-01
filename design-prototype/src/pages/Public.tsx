import React, { useState } from 'react'
import { navigate } from '../router'
import { I } from '../icons2'

export function PublicNav() {
  return (
    <header style={{ position: 'sticky', top: 0, zIndex: 100, borderBottom: '1px solid var(--border)', padding: '0 24px', height: 60, display: 'flex', alignItems: 'center', gap: 20, backdropFilter: 'blur(8px)', background: 'var(--nav-bg)' }}>
      <a href="#/" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <img src="/favicon.svg" alt="" width={28} height={28} />
        <span style={{ fontWeight: 800, fontSize: 18, color: 'var(--text-primary)' }}>NEXORA</span>
      </a>
      <div className="grow" />
      <nav style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
        <a href="#/how" className="text-sm" style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>How it works</a>
        <a href="#/difference" className="text-sm" style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>Difference</a>
        <a href="#/help" className="text-sm" style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>Help</a>
        <a href="#/faq" className="text-sm" style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>FAQ</a>
        <a href="#/use-cases" className="text-sm" style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>Use cases</a>
      </nav>
      <a href="#/signin" className="btn btn-ghost btn-sm">Sign in</a>
      <a href="#/signin" className="btn btn-primary btn-sm">Get started</a>
    </header>
  )
}

export function PublicFooter() {
  return (
    <footer style={{ background: 'var(--bg-subtle)', color: 'var(--text-secondary)', padding: '40px 24px', marginTop: 60, borderTop: '1px solid var(--border)' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 30 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <img src="/favicon.svg" alt="" width={24} height={24} /><span style={{ color: 'var(--text-primary)', fontWeight: 800 }}>NEXORA</span>
          </div>
          <p className="text-sm" style={{ color: 'var(--green-600)' }}>The Blueprint AI Software Engineering Platform.</p>
        </div>
        <div><div style={{ color: 'var(--text-primary)', fontWeight: 600, marginBottom: 10 }}>Product</div><div style={{ display: 'grid', gap: 6 }}><a href="#/how" className="text-sm" style={{ color: 'var(--text-secondary)' }}>How it works</a><a href="#/difference" className="text-sm" style={{ color: 'var(--text-secondary)' }}>Difference</a><a href="#/faq" className="text-sm" style={{ color: 'var(--text-secondary)' }}>FAQ</a></div></div>
        <div><div style={{ color: 'var(--text-primary)', fontWeight: 600, marginBottom: 10 }}>Support</div><div style={{ display: 'grid', gap: 6 }}><a href="#/help" className="text-sm" style={{ color: 'var(--text-secondary)' }}>Help center</a><a href="#/help" className="text-sm" style={{ color: 'var(--text-secondary)' }}>Customer Care</a></div></div>
        <div><div style={{ color: 'var(--text-primary)', fontWeight: 600, marginBottom: 10 }}>Legal</div><div style={{ display: 'grid', gap: 6 }}><span className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Privacy (coming soon)</span><span className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Terms (coming soon)</span></div></div>
      </div>
      <div className="center text-xs mt-16" style={{ color: 'var(--text-tertiary)' }}>Â© 2026 NEXORA.</div>
    </footer>
  )
}

export function PublicPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
      <PublicNav />
      <main style={{ flex: 1, maxWidth: 800, margin: '0 auto', padding: '48px 24px', width: '100%' }}>
        <h1 style={{ fontSize: 32, marginBottom: 8 }}>{title}</h1>
        {children}
      </main>
      <PublicFooter />
    </div>
  )
}

export function HowPage() {
  return (
    <PublicPage title="How NEXORA works">
      <p className="muted" style={{ fontSize: 17, marginBottom: 28 }}>NEXORA brings an engineering process around AI. You begin by describing what you want to create. NEXORA then works through the product with you.</p>
      <div style={{ display: 'grid', gap: 16 }}>
        {[['01 â€” DISCOVER', 'Understand the idea, goals, users, requirements, and problems the product is meant to solve.'], ['02 â€” DESIGN', 'Shape the product into a coherent system â€” its experiences, structure, capabilities, and interactions.'], ['03 â€” BLUEPRINT', 'Turn the understanding into a detailed blueprint that can be examined before implementation.'], ['04 â€” APPROVE', 'Review the blueprint and decide whether it is ready to become the basis for engineering.'], ['05 â€” BUILD', 'Engineering begins from the approved blueprint rather than from an unexplored idea.'], ['06 â€” VERIFY', 'The resulting work is independently checked against what was intended, with evidence preserved throughout.']].map(([t, d], i) => (
          <div key={i} className="card"><div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--green-700)', fontWeight: 600, marginBottom: 6 }}>{t}</div><div style={{ color: 'var(--text-secondary)' }}>{d}</div></div>
        ))}
      </div>
      <div className="card mt-24" style={{ background: 'var(--green-50)', borderColor: 'var(--green-200)' }}>
        <p style={{ fontWeight: 700, color: 'var(--green-700)' }}>Understand before building. Blueprint before code. Evidence before confidence.</p>
      </div>
    </PublicPage>
  )
}

export function DifferencePage() {
  return (
    <PublicPage title="How NEXORA is different">
      <p className="muted" style={{ fontSize: 17, marginBottom: 28 }}>NEXORA is not a code generator, not a black box, and not a one-shot tool.</p>
      {[{ t: 'Not a code generator', d: 'NEXORA does not simply turn a prompt into code. It builds a structured, verifiable blueprint first â€” so you understand what will be built before engineering begins.' }, { t: 'Not a black box', d: 'Every decision, relationship, and finding is anchored to evidence. You can trace any artifact back to its source and reasoning.' }, { t: 'Not a one-shot', d: 'NEXORA continuously re-engineers the running system against its blueprint, detecting drift and proposing safe changes.' }].map((c, i) => (
        <div key={i} className="card mb-16"><h3 style={{ marginBottom: 8 }}>{c.t}</h3><p style={{ color: 'var(--text-secondary)' }}>{c.d}</p></div>
      ))}
    </PublicPage>
  )
}
