import React from 'react'
import { PublicPage } from './Public'

export function UseCasesPage() {
  const cases = [
    {
      title: 'Building a small internal tool',
      scenario: 'A team needs a dashboard to track their engineering pipeline. They use NEXORA to design the data model, blueprint the API, and generate a working prototype — all before committing to a full build.',
    },
    {
      title: 'Designing a system before code',
      scenario: 'A founder has an idea but wants to explore it fully before engineering begins. NEXORA runs Discovery and Design, producing a structured blueprint that can be reviewed, challenged, and approved.',
    },
    {
      title: 'Operating a mature product',
      scenario: 'A team with a running system uses NEXORA to detect drift from the original blueprint, propose safe changes, and re-verify the system after each change.',
    },
  ]

  return (
    <PublicPage title="Use cases">
      <p className="muted" style={{ fontSize: 17, marginBottom: 28 }}>
        NEXORA adapts to how you work. Here are some scenarios where it fits.
      </p>
      {cases.map((c, i) => (
        <div key={i} className="card mb-16">
          <h3 style={{ marginBottom: 8 }}>{c.title}</h3>
          <p style={{ color: 'var(--ink-700)' }}>{c.scenario}</p>
        </div>
      ))}
    </PublicPage>
  )
}
