import React, { useState } from 'react'
import { I } from './icons2'
import { ApiProjectAiConfig } from './api'

/* The RUN composer. The provider/model picker is intentionally NOT re-built
   here: the project's single AI MODEL control lives on the project page
   (3.3 EXACT AI MODEL POPUP — no second AI model selector competes with it).
   This composer displays the project-bound AI model as a read-only chip and
   RUN executes (or honestly checkpoints) through that configured model. */
export function InstructionComposer({
  stageLabel,
  busy,
  onRun,
  projectAiConfig,
}: {
  stageLabel: string | null
  busy: boolean
  onRun: (instruction: string) => void
  /** Project-bound AI config (set through the project AI MODEL control). */
  projectAiConfig?: ApiProjectAiConfig | null
}) {
  const [text, setText] = useState('')
  const canRun = !!stageLabel && !busy

  return (
    <div className="composer">
      <h4 style={{ margin: '0 0 4px' }}>Blueprint instruction</h4>
      <p className="composer-note" style={{ margin: '0 0 8px' }}>Describe what the engine should produce next. RUN drives the next lifecycle stage through the project's AI model — or records an honest checkpoint when no verified model is configured.</p>
      <textarea
        className="composer-area"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="e.g. Focus the discovery on the identity requirements and enumerate the acceptance criteria."
      />

      <div className="composer-bar">
        <div
          className="composer-provider-btn"
          style={{ cursor: 'default', color: 'var(--text-primary)' }}
          title={projectAiConfig ? 'AI model bound to this project — change it from the project AI MODEL control.' : 'No verified AI model is configured — set it from the project AI MODEL control.'}
        >
          <I name="cpu" size={15} />
          <span className="cp-label">{projectAiConfig ? `${projectAiConfig.providerId} · ${projectAiConfig.modelId}` : 'AI model not configured'}</span>
          <span className={`badge ${projectAiConfig ? 'badge-green' : 'badge-gray'}`} style={{ fontSize: 10 }}>
            {projectAiConfig ? 'Project model' : 'Set from AI MODEL'}
          </span>
        </div>

        <button className="btn btn-primary composer-run" onClick={() => onRun(text.trim())} disabled={!canRun}>
          <I name="play" size={14} />
          {busy ? 'Running…' : 'RUN'}
        </button>
      </div>

      <div className="composer-note" style={{ marginTop: 6 }}>
        {projectAiConfig
          ? <>Will run: <strong>{stageLabel}</strong> through the project model <strong>{projectAiConfig.modelId}</strong> — the backend routes it honestly when the credential is verified, or records an honest checkpoint otherwise.</>
          : (stageLabel
              ? <>Will run: <strong>{stageLabel}</strong> — no verified model is configured, so the stage will be recorded as an honest checkpoint (no provider call). Set the project AI model to enable execution.</>
              : 'All in-scope lifecycle stages are recorded.')}
      </div>
    </div>
  )
}