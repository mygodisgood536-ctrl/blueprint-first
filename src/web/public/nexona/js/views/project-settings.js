/**
 * Project settings view — edit project title/mode, archive/delete.
 *
 * Backend contract:
 *   PUT /api/projects/:id → { project } (update title/mode)
 *   DELETE /api/projects/:id → 204 (soft-delete)
 */
import { api } from '../api.js';
import { router } from '../router.js';
import { toasts } from '../ui/toast.js';

function esc(s) {
  return String(s ?? '').replace(/[&<>\"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

const MODES = [
  { value: 'full-product', label: 'Full Product' },
  { value: 'design-plus-code', label: 'Design + Code' },
  { value: 'design-only', label: 'Design Only' },
];

export function mount(params, account) {
  const content = document.querySelector('#app-content');
  if (!content) return;
  if (!account) { router.go('/login'); return () => {}; }

  const projectId = params.id;

  content.innerHTML = `
    <div class="page">
      <header class="page__header">
        <div>
          <h1 class="page__title">Project settings</h1>
          <p class="page__subtitle" id="project-subtitle">Loading…</p>
        </div>
        <a class="btn btn--secondary" href="#/projects/${encodeURIComponent(projectId)}">← Back to project</a>
      </header>

      <section id="settings-body">
        <div class="card card--skeleton" aria-hidden="true">Loading…</div>
      </section>
    </div>
  `;

  document.body.classList.add('main-app');

  loadSettings().catch(() => toasts.error('Failed to load', 'Could not load project settings.'));

  async function loadSettings() {
    const body = document.getElementById('settings-body');
    const subtitleEl = document.getElementById('project-subtitle');

    let project;
    try {
      project = await api.getProject(projectId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (err?.status === 404) {
        body.innerHTML = `<div class="error-state"><p>Project not found.</p><a class="btn btn--secondary btn--sm" href="#/projects">Back to projects</a></div>`;
      } else {
        body.innerHTML = `<div class="error-state"><p>Could not load project.</p><button class="btn btn--secondary btn--sm" id="retry-btn">Retry</button></div>`;
        document.getElementById('retry-btn')?.addEventListener('click', () => loadSettings());
      }
      return;
    }

    if (subtitleEl) subtitleEl.textContent = project.title;

    body.innerHTML = `
      <form class="form card" id="settings-form" style="max-width:520px">
        <div class="form-group">
          <label class="form-label" for="title">Project title</label>
          <input class="form-input" type="text" id="title" name="title" required minlength="2" maxlength="64" value="${esc(project.title)}">
        </div>
        <div class="form-group">
          <label class="form-label" for="mode">Lifecycle mode</label>
          <select class="form-input" id="mode" name="mode">
            ${MODES.map((m) => `<option value="${m.value}" ${project.mode === m.value ? 'selected' : ''}>${m.label}</option>`).join('')}
          </select>
          <div class="form-hint">Changing mode affects which lifecycle stages are in scope.</div>
        </div>
        <div class="form-error form-error--banner" id="form-error"></div>
        <div class="form-actions">
          <button type="button" class="btn btn--secondary" id="cancel-btn">Cancel</button>
          <button type="submit" class="btn btn--primary" id="save-btn">
            <span class="btn__text">Save changes</span>
            <span class="btn__spinner" aria-hidden="true"></span>
          </button>
        </div>
      </form>

      <section class="panel panel--danger">
        <h2 class="panel__title">Danger zone</h2>
        <div class="panel__body">
          <p class="muted">Deleting a project removes it from your list. This cannot be undone.</p>
          <button class="btn btn--danger" id="delete-btn">Delete project</button>
        </div>
      </section>`;

    document.getElementById('cancel-btn')?.addEventListener('click', () => router.go(`/projects/${encodeURIComponent(projectId)}`));

    document.getElementById('settings-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const formError = document.getElementById('form-error');
      formError.textContent = '';
      const title = e.target.title.value.trim();
      const mode = e.target.mode.value;

      if (title.length < 2) {
        formError.textContent = 'Title must be at least 2 characters.';
        return;
      }

      const saveBtn = document.getElementById('save-btn');
      saveBtn.disabled = true;
      saveBtn.classList.add('btn--loading');

      try {
        await api.updateProject(projectId, { title, mode });
        toasts.success('Project updated', 'Changes saved.');
        router.go(`/projects/${encodeURIComponent(projectId)}`);
      } catch (err) {
        formError.textContent = err instanceof Error ? err.message : String(err);
        saveBtn.disabled = false;
        saveBtn.classList.remove('btn--loading');
      }
    });

    document.getElementById('delete-btn')?.addEventListener('click', async () => {
      if (confirm(`Delete project "${project.title}"? This cannot be undone.`)) {
        try {
          await api.deleteProject(projectId);
          toasts.success('Project deleted', 'The project was removed.');
          router.go('/projects');
        } catch (err) {
          toasts.error('Delete failed', err instanceof Error ? err.message : String(err));
        }
      }
    });
  }

  return () => {};
}
