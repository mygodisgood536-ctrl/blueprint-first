/**
 * Project workspace view — drive the Blueprint-First pipeline for one project.
 *
 * Backend contract:
 *   GET /api/projects/:id → { id, title, description, mode, status, stages: [{ stageId, label, inScope, status, at }], approval, ... }
 *   POST /api/projects/:id/run/:stageId → { projectId, stageId }
 *   POST /api/projects/:id/approve → { projectId, approval }
 */
import { api } from '../api.js';
import { router } from '../router.js';
import { toasts } from '../ui/toast.js';

function esc(s) {
  return String(s ?? '').replace(/[&<>\"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function modeLabel(mode) {
  return { 'design-only': 'Design Only', 'design-plus-code': 'Design + Code', 'full-product': 'Full Product' }[mode] ?? mode;
}

export function mount(params, account) {
  const content = document.querySelector('#app-content');
  if (!content) return;
  if (!account) { router.go('/login'); return () => {}; }

  const projectId = params.id;

  content.innerHTML = `
    <div class="page">
      <header class="page__header">
        <div>
          <h1 class="page__title" id="project-title">Project</h1>
          <p class="page__subtitle" id="project-subtitle">Loading…</p>
        </div>
        <div class="form-actions">
          <a class="btn btn--secondary" href="#/projects">← Back to projects</a>
        </div>
      </header>

      <section id="project-body">
        <div class="card card--skeleton" aria-hidden="true">Loading project…</div>
      </section>

      <section class="panel" id="stages-panel" hidden>
        <h2 class="panel__title">Lifecycle stages</h2>
        <div class="panel__body" id="stages-body"></div>
      </section>
    </div>
  `;

  document.body.classList.add('main-app');

  loadProject().catch(() => toasts.error('Failed to load', 'Could not load project.'));

  async function loadProject() {
    const body = document.getElementById('project-body');
    const titleEl = document.getElementById('project-title');
    const subtitleEl = document.getElementById('project-subtitle');
    const stagesPanel = document.getElementById('stages-panel');
    const stagesBody = document.getElementById('stages-body');

    let project;
    try {
      project = await api.getProject(projectId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (err?.status === 404) {
        body.innerHTML = `<div class="error-state"><p>Project not found.</p><a class="btn btn--secondary btn--sm" href="#/projects">Back to projects</a></div>`;
      } else {
        body.innerHTML = `<div class="error-state"><p>Could not load project.</p><button class="btn btn--secondary btn--sm" id="retry-btn">Retry</button></div>`;
        document.getElementById('retry-btn')?.addEventListener('click', () => loadProject());
      }
      return;
    }

    if (titleEl) titleEl.textContent = project.title;
    if (subtitleEl) subtitleEl.textContent = `${esc(modeLabel(project.mode))} · ${esc(project.id)}`;

    body.innerHTML = `
      <div class="project-detail">
        <div class="account-meta">
          <div class="account-meta__row"><span class="account-meta__label">Mode</span><span class="account-meta__value">${esc(modeLabel(project.mode))}</span></div>
          <div class="account-meta__row"><span class="account-meta__label">Status</span><span class="account-meta__value">${esc(project.status)}</span></div>
          <div class="account-meta__row"><span class="account-meta__label">Stages run</span><span class="account-meta__value">${esc(project.stagesRunCount)}</span></div>
          ${project.approval ? `<div class="account-meta__row"><span class="account-meta__label">Approval</span><span class="account-meta__value">${esc(project.approval.status)}</span></div>` : ''}
        </div>
        ${project.description ? `<p class="muted">${esc(project.description)}</p>` : ''}
      </div>`;

    // Stages
    const stages = project.stages ?? [];
    if (stages.length > 0 && stagesBody && stagesPanel) {
      stagesPanel.hidden = false;
      stagesBody.innerHTML = `
        <div class="stages-list">
          ${stages.map((s) => `
            <div class="stage-item stage-item--${esc(s.status.toLowerCase())}">
              <div class="stage-item__info">
                <span class="stage-item__label">${esc(s.label)}</span>
                <span class="stage-item__status">${esc(s.status)}</span>
              </div>
              ${s.inScope && s.status === 'PENDING' ? `<button class="btn btn--primary btn--sm run-stage-btn" data-stage="${esc(s.stageId)}">Run</button>` : ''}
              ${s.at ? `<span class="stage-item__at">${esc(new Date(s.at).toLocaleDateString())}</span>` : ''}
            </div>`).join('')}
        </div>`;

      document.querySelectorAll('.run-stage-btn').forEach((btn) => {
        btn.addEventListener('click', () => runStage(btn, btn.dataset.stage));
      });
    }
  }

  async function runStage(btn, stageId) {
    btn.disabled = true;
    btn.classList.add('btn--loading');
    try {
      await api.runStage(projectId, stageId);
      toasts.success('Stage started', `Stage "${stageId}" is running.`);
      loadProject();
    } catch (err) {
      toasts.error('Stage failed', err instanceof Error ? err.message : String(err));
      btn.disabled = false;
      btn.classList.remove('btn--loading');
    }
  }

  return () => {};
}
