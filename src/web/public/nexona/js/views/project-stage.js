/**
 * Stage 8 — Blueprint-First Workspace view.
 *
 * A single project-scoped view that dispatches to one of the 8 Blueprint-First
 * pipeline stage surfaces based on the route's :stageId parameter.
 *
 * Routes handled (all under `#/projects/:id/stages/:stageId`):
 *   discovery          — GET /api/discovery
 *   design             — GET /api/design
 *   blueprint          — GET /api/certification
 *   approval           — POST /api/projects/:id/approve (action surface)
 *   build              — POST /api/projects/:id/run/:stageId (action surface)
 *   verification       — GET /api/verification
 *   testing            — GET /api/testing
 *   operations         — GET /api/deployment
 *   runtime-telemetry  — GET /api/telemetry
 *   continuous         — GET /api/continuous
 *
 * Every interactive element performs a real supported action against a real
 * backend endpoint. No fake data, no fake progress, no fake notifications.
 *
 * States: normal, empty (no project), error (project not found), 404
 * (project missing), loading, success, error, blocked, incomplete. The
 * engine may report stages as not-yet-run (incomplete) or out-of-scope for
 * the project's mode; we surface that honestly rather than faking completion.
 */
import { api } from '../api.js';
import { router } from '../router.js';
import { toasts } from '../ui/toast.js';

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function modeLabel(mode) {
  return { 'design-only': 'Design Only', 'design-plus-code': 'Design + Code', 'full-product': 'Full Product' }[mode] ?? mode;
}

const STAGE_LABELS = {
  discovery: 'Discovery',
  design: 'Design',
  blueprint: 'Blueprint',
  approval: 'Approval',
  build: 'Build / Engineering',
  verification: 'Verification',
  testing: 'Testing',
  operations: 'Operations / Deployment',
  'runtime-telemetry': 'Runtime Telemetry',
  continuous: 'Continuous Engineering',
};

// Engine status values are uppercase: PENDING, RECORDED, OUT_OF_SCOPE.
function statusPill(status) {
  const s = (status ?? '').toString().toLowerCase();
  const cls = s === 'recorded' ? 'status-pill--recorded'
    : s === 'blocked' ? 'status-pill--blocked'
    : s === 'warning' ? 'status-pill--warning'
    : s === 'out_of_scope' ? 'status-pill--out_of_scope'
    : 'status-pill--pending';
  return `<span class="status-pill ${cls}">${esc(status)}</span>`;
}

function renderIdList(ids) {
  if (!Array.isArray(ids) || ids.length === 0) {
    return `<p class="empty-list">No artifacts recorded yet.</p>`;
  }
  return `<div class="id-list">${ids.map((id) => `<div class="id-list__row">${esc(id)}</div>`).join('')}</div>`;
}

function renderIdListOrNone(ids, noneText) {
  if (!Array.isArray(ids) || ids.length === 0) {
    return `<p class="empty-list">${esc(noneText)}</p>`;
  }
  return renderIdList(ids);
}

function renderMetaGrid(rows) {
  return `<div class="meta-grid">${rows.map((r) => `
    <div class="meta-grid__row">
      <div class="meta-grid__label">${esc(r.label)}</div>
      <div class="meta-grid__value ${r.text ? 'meta-grid__value--text' : ''}">${esc(r.value)}</div>
    </div>
  `).join('')}</div>`;
}

function renderNotes(notes) {
  if (!notes) return '';
  return `<div class="stage-panel"><div class="stage-panel__title">Notes</div><pre class="diff-view">${esc(JSON.stringify(notes, null, 2))}</pre></div>`;
}

function renderStageTabs(currentStage) {
  const stages = Object.keys(STAGE_LABELS);
  return `<div class="tabs" role="tablist">${stages.map((s) => {
    const isActive = s === currentStage;
    return `<button class="tabs__tab ${isActive ? 'tabs__tab--active' : ''}" role="tab" aria-selected="${isActive ? 'true' : 'false'}" data-stage="${esc(s)}">${esc(STAGE_LABELS[s])}</button>`;
  }).join('')}</div>`;
}

// ── Per-stage renderers ──────────────────────────────────────
function renderDiscovery(data) {
  const status = data?.status ?? 'PENDING';
  const artifactIds = data?.artifactIds ?? [];
  const findingIds = data?.findingIds ?? [];
  const uncertainties = data?.uncertainties ?? [];
  const baseline = data?.baseline ?? null;
  const diff = data?.diff ?? null;
  return `
    <div class="stage-panel">
      <div class="stage-panel__title">Discovery ${statusPill(status)}</div>
      <p class="stage-panel__subtitle">The structural inventory and verified understanding of the project's vision.</p>
      <div class="stage-panel__body">
        ${baseline ? renderMetaGrid([
          { label: 'Project', value: baseline.projectId ?? '—', text: true },
          { label: 'Total artifacts', value: baseline.totalArtifacts ?? '—' },
        ]) : ''}
        <div>
          <div class="meta-grid__label">Artifacts recorded</div>
          ${renderIdList(artifactIds)}
        </div>
        <div>
          <div class="meta-grid__label">Findings</div>
          ${renderIdListOrNone(findingIds, 'No findings.')}
        </div>
        <div>
          <div class="meta-grid__label">Uncertainties</div>
          ${Array.isArray(uncertainties) && uncertainties.length > 0
            ? `<pre class="diff-view">${esc(JSON.stringify(uncertainties, null, 2))}</pre>`
            : '<p class="empty-list">No recorded uncertainties.</p>'}
        </div>
        ${diff ? `<div><div class="meta-grid__label">Diff</div><pre class="diff-view">${esc(JSON.stringify(diff, null, 2))}</pre></div>` : ''}
      </div>
    </div>`;
}

function renderDesign(data) {
  const status = data?.status ?? 'PENDING';
  const blueprintId = data?.blueprintId ?? null;
  const artifactIds = data?.artifactIds ?? [];
  const approval = data?.approval ?? null;
  return `
    <div class="stage-panel">
      <div class="stage-panel__title">Design ${statusPill(status)}</div>
      <p class="stage-panel__subtitle">The structured design that crystallizes the verified understanding into pages, features, and workflows.</p>
      <div class="stage-panel__body">
        ${blueprintId ? renderMetaGrid([
          { label: 'Blueprint id', value: blueprintId },
        ]) : '<p class="empty-list">No blueprint produced yet.</p>'}
        <div>
          <div class="meta-grid__label">Engineering artifacts</div>
          ${renderIdList(artifactIds)}
        </div>
        ${approval ? `<div>
          <div class="meta-grid__label">Approval state</div>
          <pre class="diff-view">${esc(JSON.stringify(approval, null, 2))}</pre>
        </div>` : ''}
      </div>
    </div>`;
}

function renderBlueprint(data) {
  const status = data?.status ?? 'PENDING';
  const requiredDimensions = data?.requiredDimensions ?? data?.required ?? [];
  const presentDimensions = data?.presentDimensions ?? data?.present ?? [];
  const missingDimensions = data?.missingDimensions ?? data?.missing ?? [];
  const certified = data?.certified ?? null;
  const certifiable = data?.certifiable ?? null;
  const allRows = [
    ...presentDimensions.map((d) => ({ dim: d, state: 'passed' })),
    ...missingDimensions.map((d) => ({ dim: d, state: 'failed' })),
  ];
  if (allRows.length === 0 && Array.isArray(requiredDimensions)) {
    requiredDimensions.forEach((d) => allRows.push({ dim: d, state: 'inconclusive' }));
  }
  return `
    <div class="stage-panel">
      <div class="stage-panel__title">Blueprint ${statusPill(status)}</div>
      <p class="stage-panel__subtitle">The structured plan and its certification coverage. The certification authority refuses to certify if any required dimension is missing.</p>
      <div class="stage-panel__body">
        ${certified !== null ? renderMetaGrid([
          { label: 'Certified', value: certified ? 'Yes' : 'No' },
          ...(certifiable !== null ? [{ label: 'Certifiable', value: certifiable ? 'Yes' : 'No' }] : []),
        ]) : ''}
        ${allRows.length > 0
          ? `<div class="evidence-list">${allRows.map((r) => `
              <div class="dimension-row">
                <div class="dimension-row__name">${esc(r.dim)}</div>
                <div class="dimension-row__state dimension-row__state--${r.state}">${esc(r.state)}</div>
              </div>`).join('')}</div>`
          : renderIdListOrNone([], 'No dimensions reported yet.')}
      </div>
    </div>`;
}

function renderApproval(projectDetail) {
  const approved = projectDetail?.approval ?? null;
  const approvedAt = approved?.approvedAt ?? approved?.at ?? null;
  const approvedBy = approved?.approvedBy ?? approved?.by ?? null;
  return `
    <div class="stage-panel">
      <div class="stage-panel__title">Approval gate</div>
      <p class="stage-panel__subtitle">Approving the blueprint is a real moment of control. Nothing is built until you approve.</p>
      <div class="stage-panel__body">
        ${approvedAt
          ? renderMetaGrid([
              { label: 'Approved at', value: approvedAt, text: true },
              { label: 'Approved by', value: approvedBy ?? '—', text: true },
            ])
          : '<p class="empty-list">This project has not been approved yet.</p>'}
        <div>
          <button class="btn btn--primary" id="approve-btn" ${approvedAt ? 'disabled' : ''}>Approve blueprint</button>
          ${approvedAt
            ? '<p class="muted">The blueprint is approved. To revise, run the design stage again to produce a new blueprint.</p>'
            : '<p class="muted">Click Approve to gate engineering. This records your approval with your user id and timestamp.</p>'}
        </div>
      </div>
    </div>`;
}

function renderBuild(projectDetail) {
  const stages = projectDetail?.stages ?? [];
  const runnable = stages.filter((s) => s.inScope && s.status === 'PENDING');
  return `
    <div class="stage-panel">
      <div class="stage-panel__title">Build / Engineering</div>
      <p class="stage-panel__subtitle">Run lifecycle stages for this project. Out-of-scope stages are honestly reported as not in scope for this project's mode.</p>
      <div class="stage-panel__body">
        <div>
          <div class="meta-grid__label">Runnable in-scope stages</div>
          ${runnable.length === 0
            ? '<p class="empty-list">No in-scope stages are pending. All in-scope stages are recorded, or none are runnable for this mode.</p>'
            : `<div class="evidence-list">${runnable.map((s) => `
                <div class="evidence-row">
                  <div class="evidence-row__kind">${esc(s.stageId)}</div>
                  <div class="evidence-row__id">${esc(s.label)}</div>
                  <button class="btn btn--primary btn--sm run-stage-btn" data-stage="${esc(s.stageId)}">Run</button>
                </div>`).join('')}</div>`}
        </div>
        <div>
          <div class="meta-grid__label">All stages</div>
          <div class="evidence-list">${stages.map((s) => `
            <div class="evidence-row">
              <div class="evidence-row__kind">${esc(s.stageId)}</div>
              <div class="evidence-row__id">${esc(s.label)} ${s.inScope ? '' : '<span class="muted">(out of scope)</span>'}</div>
              <div class="evidence-row__meta">${statusPill(s.status)}</div>
            </div>`).join('')}</div>
        </div>
      </div>
    </div>`;
}

function renderVerification(data) {
  const masterPassed = data?.masterPassed ?? null;
  const subjects = data?.subjectsAudited ?? 0;
  const blockingFails = data?.blockingFails ?? 0;
  const inconclusive = data?.unresolvedInconclusive ?? 0;
  const closureCount = data?.closureArtifactCount ?? 0;
  const reports = data?.reports ?? 0;
  const rollup = data?.rollup ?? null;
  const notes = data?.notes ?? null;
  const rows = [
    { label: 'Master verdict', value: masterPassed === null ? '—' : (masterPassed ? 'PASS' : 'FAIL'), text: true },
    { label: 'Subjects audited', value: String(subjects) },
    { label: 'Blocking fails', value: String(blockingFails) },
    { label: 'Unresolved inconclusive', value: String(inconclusive) },
    { label: 'Closure artifacts', value: String(closureCount) },
    { label: 'Reports', value: String(reports) },
  ];
  return `
    <div class="stage-panel">
      <div class="stage-panel__title">Verification ${masterPassed === null ? statusPill('PENDING') : statusPill(masterPassed ? 'RECORDED' : 'BLOCKED')}</div>
      <p class="stage-panel__subtitle">Master verification across the eleven Blueprint-First dimensions.</p>
      <div class="stage-panel__body">
        ${renderMetaGrid(rows)}
        ${rollup ? `<div><div class="meta-grid__label">Rollup</div><pre class="diff-view">${esc(JSON.stringify(rollup, null, 2))}</pre></div>` : ''}
        ${renderNotes(notes)}
      </div>
    </div>`;
}

function renderTesting(data) {
  const status = data?.status ?? 'PENDING';
  const executed = data?.executed ?? 0;
  const testIds = data?.testIds ?? [];
  const advanced = data?.advancedToTestVerified ?? null;
  const halts = data?.docHalts ?? null;
  return `
    <div class="stage-panel">
      <div class="stage-panel__title">Testing ${statusPill(status)}</div>
      <p class="stage-panel__subtitle">Acceptance testing. The test department runs the suite; halted-on-doc is a fail-closed behavior.</p>
      <div class="stage-panel__body">
        ${renderMetaGrid([
          { label: 'Executed', value: String(executed) },
          { label: 'Advanced to test-verified', value: advanced === null ? '—' : (advanced ? 'Yes' : 'No') },
        ])}
        <div>
          <div class="meta-grid__label">Test artifacts</div>
          ${renderIdList(testIds)}
        </div>
        ${halts ? `<div><div class="meta-grid__label">Doc halts</div><pre class="diff-view">${esc(JSON.stringify(halts, null, 2))}</pre></div>` : ''}
      </div>
    </div>`;
}

function renderOperations(data) {
  const status = data?.status ?? 'PENDING';
  const executed = data?.executed ?? 0;
  const deployIds = data?.deployIds ?? [];
  const manifestId = data?.manifestId ?? null;
  const advanced = data?.advancedToDeployedVerified ?? null;
  const halts = data?.docHalts ?? null;
  return `
    <div class="stage-panel">
      <div class="stage-panel__title">Operations / Deployment ${statusPill(status)}</div>
      <p class="stage-panel__subtitle">Deployment runs gated by evidence. Advanced-to-deployed-verified is a strict precondition for runtime.</p>
      <div class="stage-panel__body">
        ${renderMetaGrid([
          { label: 'Executed', value: String(executed) },
          { label: 'Manifest id', value: manifestId ?? '—' },
          { label: 'Advanced to deployed-verified', value: advanced === null ? '—' : (advanced ? 'Yes' : 'No') },
        ])}
        <div>
          <div class="meta-grid__label">Deploy artifacts</div>
          ${renderIdList(deployIds)}
        </div>
        ${halts ? `<div><div class="meta-grid__label">Doc halts</div><pre class="diff-view">${esc(JSON.stringify(halts, null, 2))}</pre></div>` : ''}
      </div>
    </div>`;
}

function renderTelemetry(data) {
  const observation = data?.observation ?? null;
  const sourceKind = data?.sourceKind ?? null;
  return `
    <div class="stage-panel">
      <div class="stage-panel__title">Runtime Telemetry</div>
      <p class="stage-panel__subtitle">The runtime observation surface. Reports anomalies and drift between the running system and its blueprint.</p>
      <div class="stage-panel__body">
        ${renderMetaGrid([
          { label: 'Source kind', value: sourceKind ?? '—' },
        ])}
        ${observation
          ? `<div><div class="meta-grid__label">Observation</div><pre class="diff-view">${esc(JSON.stringify(observation, null, 2))}</pre></div>`
          : '<p class="empty-list">No telemetry observation reported yet.</p>'}
      </div>
    </div>`;
}

function renderContinuous(data) {
  const verdict = data?.finalVerdict ?? null;
  const rationale = data?.rationale ?? null;
  const materialization = data?.materialization ?? null;
  return `
    <div class="stage-panel">
      <div class="stage-panel__title">Continuous Engineering ${verdict ? statusPill(verdict) : statusPill('PENDING')}</div>
      <p class="stage-panel__subtitle">The platform's continuous watch: drift detection, impact analysis, remediation, and the long-arc evolution review.</p>
      <div class="stage-panel__body">
        ${renderMetaGrid([
          { label: 'Final verdict', value: verdict ?? '—', text: true },
        ])}
        ${rationale ? `<div><div class="meta-grid__label">Rationale</div><p class="meta-grid__value meta-grid__value--text">${esc(rationale)}</p></div>` : ''}
        ${materialization ? `<div><div class="meta-grid__label">Materialization</div><pre class="diff-view">${esc(JSON.stringify(materialization, null, 2))}</pre></div>` : ''}
      </div>
    </div>`;
}

// ── Stage data fetchers ──────────────────────────────────────
// Each fetcher returns a Promise<{ ok, data?, error? }> so the renderer
// can surface 404, network failure, etc., honestly.
async function fetchStage(stageId) {
  try {
    switch (stageId) {
      case 'discovery': return { ok: true, data: await api.getDiscovery() };
      case 'design': return { ok: true, data: await api.getDesign() };
      case 'blueprint': return { ok: true, data: await api.getCertification() };
      case 'verification': return { ok: true, data: await api.getVerification() };
      case 'testing': return { ok: true, data: await api.getTesting() };
      case 'operations': return { ok: true, data: await api.getDeployment() };
      case 'runtime-telemetry': return { ok: true, data: await api.getTelemetry() };
      case 'continuous': return { ok: true, data: await api.getContinuous() };
      default: return { ok: false, error: `Unknown stage: ${stageId}` };
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// Stage renderers that do not need backend data and act on project state.
const PROJECT_ONLY = new Set(['approval', 'build']);

function renderStage(stageId, data, projectDetail) {
  if (PROJECT_ONLY.has(stageId)) {
    if (stageId === 'approval') return renderApproval(projectDetail);
    if (stageId === 'build') return renderBuild(projectDetail);
  }
  switch (stageId) {
    case 'discovery': return renderDiscovery(data);
    case 'design': return renderDesign(data);
    case 'blueprint': return renderBlueprint(data);
    case 'verification': return renderVerification(data);
    case 'testing': return renderTesting(data);
    case 'operations': return renderOperations(data);
    case 'runtime-telemetry': return renderTelemetry(data);
    case 'continuous': return renderContinuous(data);
    default: return `<div class="error-state"><p>Unknown stage: ${esc(stageId)}</p></div>`;
  }
}

// ── Mount ─────────────────────────────────────────────────────
export function mount(params, account) {
  const content = document.querySelector('#app-content');
  if (!content) return;
  if (!account) { router.go('/login'); return () => {}; }

  const projectId = params.id;
  const stageId = params.stageId;

  if (!projectId) { router.go('/projects'); return () => {}; }
  if (!stageId || !STAGE_LABELS[stageId]) {
    router.go(`/projects/${encodeURIComponent(projectId)}`);
    return () => {};
  }

  content.innerHTML = `
    <div class="page">
      <header class="page__header">
        <div>
          <a class="back-link" href="#/projects/${encodeURIComponent(projectId)}">← Back to project</a>
          <h1 class="page__title" id="stage-page-title">${esc(STAGE_LABELS[stageId])}</h1>
          <p class="page__subtitle" id="stage-page-subtitle">Loading project…</p>
        </div>
        <a class="btn btn--secondary" id="settings-link" href="#/projects/${encodeURIComponent(projectId)}/settings">Project settings</a>
      </header>
      ${renderStageTabs(stageId)}
      <section id="stage-body">
        <div class="card card--skeleton" aria-hidden="true">Loading…</div>
      </section>
    </div>
  `;

  document.body.classList.add('main-app');

  // Wire tab clicks so the user can move between stages without going
  // back to the project hub. Each tab navigates to a real route.
  document.querySelectorAll('.tabs__tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const next = tab.dataset.stage;
      if (!next || next === stageId) return;
      router.go(`/projects/${encodeURIComponent(projectId)}/stages/${next}`);
    });
  });

  // Closure-scoped loader: projectId and stageId are captured.
  loadStage(projectId, stageId).catch((err) => {
    toasts.error('Failed to load', err instanceof Error ? err.message : String(err));
  });

  return () => {};
}

async function loadStage(projectId, stageId) {
  const body = document.getElementById('stage-body');
  const subtitleEl = document.getElementById('stage-page-subtitle');
  if (!body) return;

  // 1) Load project detail (for identity + approval/stages context).
  let projectDetail = null;
  try {
    projectDetail = await api.getProject(projectId);
  } catch (err) {
    const status = err && typeof err === 'object' && 'status' in err ? err.status : 0;
    if (status === 404) {
      body.innerHTML = `
        <div class="error-state">
          <div class="error-state__icon">&#10060;</div>
          <h3 class="error-state__title">Project not found</h3>
          <p class="error-state__desc">It may have been deleted or it belongs to another account.</p>
          <div class="error-state__action"><a class="btn btn--secondary" href="#/projects">Back to projects</a></div>
        </div>`;
      if (subtitleEl) subtitleEl.textContent = 'Not found';
      return;
    }
    body.innerHTML = `
      <div class="error-state">
        <div class="error-state__icon">&#9888;&#65039;</div>
        <h3 class="error-state__title">Could not load project</h3>
        <p class="error-state__desc">${esc(err instanceof Error ? err.message : String(err))}</p>
        <div class="error-state__action"><button class="btn btn--primary" id="stage-retry">Retry</button></div>
      </div>`;
    if (subtitleEl) subtitleEl.textContent = 'Error';
    document.getElementById('stage-retry')?.addEventListener('click', () => loadStage(projectId, stageId));
    return;
  }

  if (subtitleEl) {
    subtitleEl.textContent = `${esc(modeLabel(projectDetail.mode))} · ${esc(projectDetail.id)} · ${esc(projectDetail.title)}`;
  }

  // 2) Approval and Build are pure project-state actions; the rest fetch
  //    a stage-specific endpoint. The fetch failure must be shown as a
  //    real error state with retry, not a fake "unavailable" placeholder.
  if (PROJECT_ONLY.has(stageId)) {
    body.innerHTML = renderStage(stageId, null, projectDetail);
    wireStageActions(projectId, stageId);
    return;
  }

  const result = await fetchStage(stageId);
  if (!result.ok) {
    body.innerHTML = `
      <div class="error-state">
        <div class="error-state__icon">&#9888;&#65039;</div>
        <h3 class="error-state__title">Could not load ${esc(STAGE_LABELS[stageId])}</h3>
        <p class="error-state__desc">${esc(result.error ?? 'Unknown error')}</p>
        <div class="error-state__action"><button class="btn btn--primary" id="stage-retry">Retry</button></div>
      </div>`;
    document.getElementById('stage-retry')?.addEventListener('click', () => loadStage(projectId, stageId));
    return;
  }

  body.innerHTML = renderStage(stageId, result.data, projectDetail);
  wireStageActions(projectId, stageId);
}

// Wire the per-stage actions. Approval and Build call real backend
// endpoints; success and failure are both surfaced honestly.
function wireStageActions(projectId, stageId) {
  if (stageId === 'approval') {
    const btn = document.getElementById('approve-btn');
    if (btn && !btn.disabled) {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.classList.add('btn--loading');
        try {
          await api.approveBlueprint(projectId);
          toasts.success('Approved', 'Blueprint approved. Engineering may proceed.');
          await loadStage(projectId, stageId);
        } catch (err) {
          toasts.error('Approval failed', err instanceof Error ? err.message : String(err));
          btn.disabled = false;
          btn.classList.remove('btn--loading');
        }
      });
    }
  }
  if (stageId === 'build') {
    document.querySelectorAll('.run-stage-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const stageIdToRun = btn.dataset.stage;
        if (!stageIdToRun) return;
        btn.disabled = true;
        btn.classList.add('btn--loading');
        try {
          await api.runStage(projectId, stageIdToRun);
          toasts.success('Stage started', `Stage "${stageIdToRun}" is running.`);
          await loadStage(projectId, stageId);
        } catch (err) {
          toasts.error('Stage failed', err instanceof Error ? err.message : String(err));
          btn.disabled = false;
          btn.classList.remove('btn--loading');
        }
      });
    });
  }
}


