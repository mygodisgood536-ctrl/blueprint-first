import React, { useState } from 'react'
import { Shell } from '../shell'
import { I } from '../icons2'
import { navigate } from '../router'

/* Help Center / Customer Care — §8.5 / §80.3 (Gmail + WhatsApp chooser). */
import { CARE_EMAIL, GMAIL_COMPOSE_URL, WHATSAPP_URL, MAILTO_URL } from '../mock/contact'
export { GMAIL_COMPOSE_URL, WHATSAPP_URL, MAILTO_URL }

interface Article { slug: string; title: string; cat: string; body: string[] }

const helpCategories = ['Getting started', 'Projects', 'Documents', 'Providers', 'Account', 'Security', 'Troubleshooting']

const articles: Article[] = [
  { slug: 'creating-your-account', cat: 'Getting started', title: 'Creating your account',
    body: ['Choose Sign up from the home page. Enter a username, email, display name, and a password (at least 6 characters).',
      'After signing up you will be guided to set up two-factor authentication with an authenticator app before you continue.'] },
  { slug: 'your-first-project', cat: 'Getting started', title: 'Your first project',
    body: ['Open the dashboard and choose New project. Give it a name and optional description, then choose a mode: Design-only, Design-plus-code, or Full-product.',
      'Upload source documents so NEXORA can classify them. Once created, the Blueprint-First pipeline starts and your workspace opens with the design stage.'] },
  { slug: 'understanding-the-lifecycle', cat: 'Getting started', title: 'Understanding the lifecycle',
    body: ['NEXORA is blueprint-first: every product moves through design → engineering → verification before anything ships.',
      'Design produces blueprint artifacts. Engineering turns them into implementation artifacts. Verification checks the result and records evidence.'] },
  { slug: 'creating-a-project', cat: 'Projects', title: 'Creating a project',
    body: ['Go to Projects and choose New project. Fill in the name and choose a mode.',
      'You can add more documents later from the Documents page, and open project settings to rename or delete it.'] },
  { slug: 'choosing-a-mode', cat: 'Projects', title: 'Choosing a mode',
    body: ['Design-only explores and designs your idea without writing code.',
      'Design-plus-code adds engineering on top of the design. Full-product covers the entire lifecycle including verification, deployment, and operations.'] },
  { slug: 'the-project-workspace', cat: 'Projects', title: 'The project workspace',
    body: ['The workspace is the hub for a single project: stages, artifacts, evidence, and traceability.',
      'Use the stage tabs to move through the pipeline and open any artifact to see its detail.'] },
  { slug: 'uploading-documents', cat: 'Documents', title: 'Uploading documents',
    body: ['From the Documents page choose Upload. You can upload markdown, PDF, or text files.',
      'NEXORA classifies each document and records it in the document store as source material for your blueprint.'] },
  { slug: 'ingestion-classification', cat: 'Documents', title: 'How ingestion classification works',
    body: ['Uploaded documents are scanned and classified by type: product idea, requirement, constraint, or reference.',
      'Classification decides which blueprint artifacts the document contributes to. Seek Classification on each row.'] },
  { slug: 'adding-a-provider', cat: 'Providers', title: 'Adding a provider',
    body: ['Go to Providers to browse the model catalogue. Choose a provider and select Add credential.',
      'Enter a label and the API key. The secret is never shown again — NEXORA only records that it is verified.'] },
  { slug: 'managing-credentials', cat: 'Providers', title: 'Managing credentials',
    body: ['The Credentials page lists each provider credential with its verification status.',
      'You can add, verify, or remove credentials. Removing a credential does not delete the provider.'] },
  { slug: 'selecting-a-model', cat: 'Providers', title: 'Selecting a model',
    body: ['A provider credential must be verified before one of its models can be selected.',
      'Open a model from the catalogue and choose Select this model. The model status shows connected, auth required, rate limited, or unavailable.'] },
  { slug: 'profile-settings', cat: 'Account', title: 'Profile settings',
    body: ['Settings → Profile shows your display name, username, role, member-since date, and account ID. Email is not stored by this deployment.',
      'Choose Edit to change your display name. The shell updates with your new name after saving.'] },
  { slug: 'account-security', cat: 'Account', title: 'Account security',
    body: ['Settings → Security is the hub for password, authenticator, sessions, and security events.',
      'Enable two-factor authentication to protect your account with TOTP from an authenticator app.'] },
  { slug: 'sessions-help', cat: 'Account', title: 'Sessions',
    body: ['Sessions lists every device where you are signed in, with the current session marked.',
      'You can revoke an individual session or sign out of all other sessions in one action.'] },
  { slug: 'totp-help', cat: 'Security', title: 'Setting up the authenticator',
    body: ['From Security → Authenticator choose Add an authenticator. Scan the QR code or enter the manual key.',
      'Enter the 6-digit code from your app to verify, then save your recovery codes and confirm.'] },
  { slug: 'recovery-codes-help', cat: 'Security', title: 'Using recovery codes',
    body: ['If you lose your authenticator, use a recovery code to sign in and re-enroll a new one.',
      'Each recovery code can be used once. New codes are generated when you replace the authenticator.'] },
  { slug: 'session-expired', cat: 'Troubleshooting', title: 'Session expired',
    body: ['If your session has expired, you will be returned to the log in page with a message.',
      'Simply log in again to continue where you left off.'] },
  { slug: 'model-unavailable', cat: 'Troubleshooting', title: 'Model unavailable',
    body: ['A model can be unavailable when the provider rejects a request or the credential is not verified.',
      'Check the Providers page for the model status, verify the credential, then retry.'] },
  { slug: 'reset-password-help', cat: 'Troubleshooting', title: 'Reset your password',
    body: ['From the log in page choose Forgot password and enter your email.',
      'Enter the reset code you receive, then set a new password (at least 6 characters) and log in.'] },
]

/* ---------- Customer Care — channel chooser per §80.3 ---------- */
function CustomerCare() {
  const [open, setOpen] = useState(false)
  return (
    <div className="card care-card">
      <div className="row" style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div className="sec-icon"><I name="help" size={20} /></div>
        <div style={{ flex: 1, minWidth: 260 }}>
          <h4 className="mb-4">Customer Care</h4>
          <p className="text-sm muted">Direct support from the founder, Cornelius Adedeji Victor. Response within 24 hours.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setOpen(!open)}>{open ? 'Close' : 'Contact Customer Care'}</button>
      </div>
      {open && (
        <div className="care-actions mt-12">
          <p className="text-sm muted mb-12">Choose a channel — your details are never copied, each channel opens ready to send:</p>
          <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
            <a className="btn btn-outline" href={GMAIL_COMPOSE_URL} target="_blank" rel="noreferrer"><I name="mail" /> Gmail</a>
            <a className="btn btn-outline" href={WHATSAPP_URL} target="_blank" rel="noreferrer"><I name="moreH" /> WhatsApp</a>
          </div>
        </div>
      )}
    </div>
  )
}

export function HelpPage() {
  const [q, setQ] = useState('')
  const cats = helpCategories.map(cat => ({
    cat,
    items: articles.filter(a => a.cat === cat && (!q || (a.title + ' ' + a.body.join(' ')).toLowerCase().includes(q.toLowerCase()))),
  })).filter(c => c.items.length > 0)

  return (
    <Shell breadcrumb={[{ label: 'Help' }]}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <a href="#/dashboard" className="back-link" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 16 }}>
          <I name="arrowLeft" size={14} /> Back to dashboard
        </a>
        <div className="mb-8">
          <h1 style={{ fontSize: 32, marginBottom: 8 }}>Help center</h1>
          <p className="muted" style={{ fontSize: 16, marginBottom: 24 }}>Browse the library, or contact Customer Care below.</p>
          <input
            className="search-input"
            placeholder="Search help articles…"
            value={q}
            onChange={e => setQ(e.target.value)}
          />
        </div>
        {cats.length === 0 && (<div className="card"><div className="empty-note">No articles match “{q}”.</div></div>)}
        {cats.map(({ cat, items }) => (
          <div key={cat} className="mb-24">
            <h3 style={{ fontSize: 19, marginBottom: 12 }}>{cat}</h3>
            <div className="help-grid">
              {items.map((a, i) => (
                <a key={a.slug} href={`#/help/article/${a.slug}`} className="card card-hover help-card">
                  <h4 style={{ marginBottom: 6 }}>{a.title}</h4>
                  <p className="text-sm muted">{a.body[0].slice(0, 110)}…</p>
                </a>
              ))}
            </div>
          </div>
        ))}
        <div className="mt-24" />
        <CustomerCare />
      </div>
    </Shell>
  )
}

export function HelpArticle({ slug }: { slug: string }) {
  const article = articles.find(a => a.slug === slug)
  if (!article) {
    return (
      <Shell breadcrumb={[{ label: 'Help', route: '#/help' }, { label: 'Article not found' }]}>
        <div style={{ maxWidth: 760, margin: '0 auto' }}>
          <a href="#/help" className="back-link" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 16 }}>
            <I name="arrowLeft" size={14} /> Back to help center
          </a>
          <div className="card">
            <h2 className="mb-8">Article not found</h2>
            <p className="muted text-sm mb-16">That help article does not exist.</p>
            <a href="#/help" className="btn btn-ghost"><I name="arrowLeft" size={16} /> Back to help center</a>
          </div>
        </div>
      </Shell>
    )
  }
  return (
    <Shell breadcrumb={[{ label: 'Help', route: '#/help' }, { label: article.title }]}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <a href="#/help" className="back-link" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 16 }}>
          <I name="arrowLeft" size={14} /> Back to help center
        </a>
        <div className="card" style={{ marginTop: 12 }}>
          <span className="badge badge-green">{article.cat}</span>
          <h1 className="mt-12" style={{ fontSize: 28 }}>{article.title}</h1>
          <div className="article-body" style={{ display: 'grid', gap: 12 }}>
            {article.body.map((p, i) => <p key={i} className="text-sm" style={{ lineHeight: 1.6 }}>{p}</p>)}
          </div>
        </div>
        <div className="mt-16" />
        <CustomerCare />
      </div>
    </Shell>
  )
}

/* ---------- FAQ (§8.6) ---------- */

const faqGroups = [
  { name: 'Visitors', qa: [
    ['What is NEXORA?', 'NEXORA is an AI software engineering platform that takes an idea and turns it into a structured, understandable, and verifiable system — blueprint first.'],
    ['Is NEXORA free to try?', 'You can create an account and explore the workspace. Provider costs depend on the model you select.'],
  ]},
  { name: 'New users', qa: [
    ['Which project mode should I choose?', 'Design-only explores and designs. Design-plus-code adds engineering. Full-product covers the entire lifecycle including deployment and operations.'],
    ['How is this different from an AI code generator?', 'NEXORA builds a verifiable blueprint with evidence before any code is written.'],
  ]},
  { name: 'Returning users', qa: [
    ['How do I add a provider?', 'Go to Providers, choose a provider, and add your API key. The system verifies it before the model becomes selectable.'],
    ['What is evidence?', 'Every artifact carries evidence — the source material, decisions, and verifications that support it.'],
    ['How do I protect my account?', 'Enable two-factor authentication from Settings → Security. You scan a QR code with your authenticator app and save your recovery codes.'],
  ]},
]

export function FaqPage() {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <Shell breadcrumb={[{ label: 'Help', route: '#/help' }, { label: 'FAQ' }]}>
      <div style={{ maxWidth: 800, margin: '0 auto' }}>
        <a href="#/help" className="back-link" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 16 }}>
          <I name="arrowLeft" size={14} /> Back to help center
        </a>
        <h1 style={{ fontSize: 32, marginBottom: 8 }}>Frequently asked questions</h1>
        <p className="muted" style={{ fontSize: 16, marginBottom: 28 }}>Organized by audience and topic.</p>
        {faqGroups.map((g, gi) => (
          <div key={gi} className="mb-24">
            <h3 style={{ fontSize: 19, marginBottom: 12 }}>{g.name}</h3>
            <div style={{ display: 'grid', gap: 8 }}>
              {g.qa.map(([q, a], qi) => {
                const id = `${gi}-${qi}`
                return (
                  <div key={qi} className="card faq-card">
                    <button className="btn-block row-between" style={{ padding: 16, textAlign: 'left' }} onClick={() => setOpen(open === id ? null : id)}>
                      <span style={{ fontWeight: 600 }}>{q}</span><I name={open === id ? 'chevronDown' : 'chevronRight'} />
                    </button>
                    {open === id && <div style={{ padding: '12px 16px 16px', color: 'var(--ink-700)' }}>{a}</div>}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </Shell>
  )
}

/* ---------- Founder (§80.3) — inside authenticated app, NOT public intro ---------- */

export function Founder() {
  return (
    <Shell breadcrumb={[{ label: 'Account', route: '#/settings/profile' }, { label: 'About' }]}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <a href="#/dashboard" className="back-link" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 16 }}>
          <I name="arrowLeft" size={14} /> Back to dashboard
        </a>
        <div className="card" style={{ marginBottom: 16 }}>
          <h1 style={{ fontSize: 28, marginBottom: 4 }}>About the Founder</h1>
          <p className="muted" style={{ fontSize: 15 }}>The person behind NEXORA's vision for blueprint-first engineering.</p>
        </div>

        <div className="card mb-16">
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
            <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'linear-gradient(135deg, var(--green-500), var(--green-700))', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 24 }}>CV</div>
            <div>
              <h2 style={{ fontSize: 20, marginBottom: 2 }}>Cornelius Adedeji Victor</h2>
              <p className="muted" style={{ fontSize: 14 }}>Founder & Creator of NEXORA</p>
            </div>
          </div>

          <div className="article-body" style={{ display: 'grid', gap: 14 }}>
            <h3 style={{ fontSize: 17 }}>Why NEXORA exists</h3>
            <p className="text-sm" style={{ lineHeight: 1.7 }}>
              NEXORA began with a question: What if AI software development worked more like an engineering organization?
            </p>
            <p className="text-sm" style={{ lineHeight: 1.7 }}>
              Today, an idea can become code incredibly quickly. But speed does not guarantee that the right thing was built. Requirements can be misunderstood. Important decisions can disappear inside conversations. Different parts of a product can become disconnected. Risks can be overlooked.
            </p>
            <p className="text-sm" style={{ lineHeight: 1.7, fontWeight: 600, color: 'var(--green-700)' }}>
              The deeper problem was not that AI couldn't write code. It was that code was being written without a blueprint.
            </p>
            <p className="text-sm" style={{ lineHeight: 1.7 }}>
              That led to the idea behind NEXORA: an organization that does not simply generate. It explores, designs, blueprints, reviews, and verifies before engineering moves forward.
            </p>

            <h3 style={{ fontSize: 17, marginTop: 12 }}>The vision</h3>
            <div style={{ display: 'grid', gap: 8, padding: '16px 20px', background: 'var(--green-50)', borderRadius: 12, border: '1px solid var(--green-200)' }}>
              <p className="text-sm" style={{ lineHeight: 1.6, fontWeight: 600, color: 'var(--green-700)' }}>Software should not only be generated.</p>
              <p className="text-sm" style={{ lineHeight: 1.6, fontWeight: 600, color: 'var(--green-700)' }}>It should be understood.</p>
              <p className="text-sm" style={{ lineHeight: 1.6, fontWeight: 600, color: 'var(--green-700)' }}>It should be engineered.</p>
              <p className="text-sm" style={{ lineHeight: 1.6, fontWeight: 600, color: 'var(--green-700)' }}>It should be verified.</p>
            </div>
            <p className="text-sm" style={{ lineHeight: 1.7 }}>
              NEXORA was conceived to give people a better engineering environment around increasingly capable AI — one where every decision is traceable, every artifact carries evidence, and nothing is built without a blueprint.
            </p>
            <p className="text-sm" style={{ lineHeight: 1.7 }}>
              The goal is not simply to produce more software. The goal is to build software that can be understood, challenged, verified, and trusted.
            </p>
          </div>
        </div>

        <div className="card" style={{ borderColor: 'var(--green-200)', background: 'linear-gradient(135deg, var(--green-50), var(--surface))' }}>
          <h3 style={{ fontSize: 17, marginBottom: 6 }}>Contact the founder</h3>
          <p className="text-sm muted" style={{ marginBottom: 14 }}>Questions, ideas, or feedback about NEXORA? Reach Cornelius directly — typically answered within 24 hours.</p>
          <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
                        <a className="btn btn-outline" href={GMAIL_COMPOSE_URL} target="_blank" rel="noreferrer"><I name="mail" /> Gmail</a>
            <a className="btn btn-outline" href={WHATSAPP_URL} target="_blank" rel="noreferrer"><I name="moreH" /> WhatsApp</a>
            <a className="text-sm" href={MAILTO_URL}>{CARE_EMAIL}</a>
          </div>
        </div>
      </div>
    </Shell>
  )
}

export function NotFound() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16, padding: 24 }}>
      <div style={{ fontSize: 72, fontWeight: 900, color: 'var(--green-500)' }}>404</div>
      <h2>Page not found</h2>
      <p className="muted text-sm">The page you are looking for does not exist.</p>
      <a href="#/dashboard" className="btn btn-primary mt-12">Go to dashboard</a>
    </div>
  )
}