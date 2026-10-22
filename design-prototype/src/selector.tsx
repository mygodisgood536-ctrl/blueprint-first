import React, { useState } from 'react'
import { I } from './icons2'
import { ApiProjectAiConfig } from './api'
import { AiConfigurationPanel } from './modelPopup'

/* The RUN composer and the AI CONFIGURATION panel are ONE workspace.
   The provider/model control is not a separate settings page and not a second
   selector competing with the project AI MODEL control: it is the SAME control,
   rendered beside the composer so the user can see exactly which model will
   execute the instruction they are about to give.

   The order inside the panel is fixed by the approved structure:
   Free Models, then API Provider, then the API key (only when the selected
   provider genuinely requires one), then the Model. */
export function InstructionComposer({
  stageLabel,
  busy,
  onRun,
  projectAiConfig,
  onProjectAiConfigChange,
}: {
  stageLabel: string | null
  busy: boolean
  onRun: (instruction: string) => void
  /** Project-bound AI config (set through the project AI MODEL control). */
  projectAiConfig?: ApiProjectAiConfig | null
  /** Persists the project-bound AI configuration from the panel. */
  onProjectAiConfigChange?: (v: ApiProjectAiConfig) => Promise<void> | void
}) {
  const [text, setText] = useState('')
  const canRun = !!stageLabel && !busy

  return (
    <div className="composer-workspace">
      <div className="composer">
        <h4 style={{ margin: '0 0 4px' }}>Blueprint instruction</h4>
        <p className="composer-note" style={{ margin: '0 0 8px' }}>
          Describe what the engine should produce next. RUN drives the next lifecycle stage through the
          project's AI model — or records an honest checkpoint when no verified model is configured.
        </p>
        <textarea
          className="composer-area"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. Focus the discovery on the identity requirements and enumerate the acceptance criteria."
          aria-label="Describe what to build"
        />

        <div className="composer-bar">
          <div
            className="composer-provider-btn"
            style={{ cursor: 'default', color: 'var(--text-primary)' }}
            title={projectAiConfig
              ? `AI model bound to this project: ${projectAiConfig.providerId} · ${projectAiConfig.modelId}`
              : 'No verified AI model is configured — choose one in the AI configuration panel beside this composer.'}
          >
            <I name="cpu" size={15} />
            <span className="cp-label">
              {projectAiConfig ? `${projectAiConfig.providerId} · ${projectAiConfig.modelId}` : 'AI model not configured'}
            </span>
            <span className={`badge ${projectAiConfig ? 'badge-green' : 'badge-gray'}`} style={{ fontSize: 10 }}>
              {projectAiConfig ? 'Project model' : 'Set in AI configuration'}
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
                ? <>Will run: <strong>{stageLabel}</strong> — no verified model is configured, so the stage will be recorded as an honest checkpoint (no provider call). Choose a model in the AI configuration panel to enable execution.</>
                : 'All in-scope lifecycle stages are recorded.')}
        </div>
      </div>

      {onProjectAiConfigChange !== undefined && (
        <AiConfigurationPanel
          variant="panel"
          value={projectAiConfig ?? null}
          onChange={onProjectAiConfigChange}
        />
      )}
    </div>
  )
}
