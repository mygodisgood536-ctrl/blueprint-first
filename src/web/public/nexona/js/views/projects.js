/**
 * Projects list view — per-user project listing with real backend data.
 *
 * Backend contract:
 *   GET /api/projects → { count, projects: [{ id, title, mode, status, lifecycleComplete }] }
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

function modeLabel(mode) {
  return { 'design-only': 'Design Only', 'design-plus-code': 'Design + Code', 'full-product': 'Full Product' }[mode] ?? mode;
}

export function mount(params, account) {
  const content = document.querySelector('#app-content');
  if (!content) return;
  if (!account) { router.go('/login'); return () => {}; }

  content.innerHTML = `
    <div class="page">
      <header class="page__header">
        <div>
          <h1 class="page__title">Projects</h1>
          <p class="page__subtitle">Your Blueprint-First engineering projects.</p>
        </div>
        <button class="btn btn--primary" id="new-project-btn">+ New Project</button>
      </header>

      <section id="projects-body">
        <div class="card card--skeleton" aria-hidden="true">Loading projects…</div>
      </section>
    </div>
  `;

  document.getElementById('new-project-btn')?.addEventListener('click', () => router.go('/projects/new'));
  document.body.classList.add('main-app');

  loadProjects().catch(() => toasts.error('Failed to load', 'Could not load projects.'));

  async function loadProjects() {
    const body = document.getElementById('projects-body');
    if (!body) return;

    let res;
    try {
      res = await api.listProjects();
    } catch (err) {
      body.innerHTML = `<div class="error-state"><p>Could not load projects.</p><button class="btn btn--secondary btn--sm" id="retry-btn">Retry</button></div>`;
      document.getElementById('retry-btn')?.addEventListener('click', () => loadProjects());
      return;
    }

    const projects = res.projects ?? [];
    if (projects.length === 0) {
      body.innerHTML = `
        <div class="empty-state">
          <div class="empty-state__icon">📁</div>
          <h3 class="empty-state__title">No projects yet</h3>
          <p class="empty-state__desc">Create your first project to start the Blueprint-First engineering lifecycle.</p>
          <button class="btn btn--primary" id="empty-new-project">Create your first project</button>
        </div>`;
      document.getElementById('empty-new-project')?.addEventListener('click', () => router.go('/projects/new'));
      return;
    }

    body.innerHTML = `
      <div class="project-grid">
        ${projects.map((p) => `
          <div class="project-card" data-id="${esc(p.id)}">
            <div class="project-card__header">
              <h3 class="project-card__title">${esc(p.title)}</h3>
              <span class="badge">${esc(modeLabel(p.mode))}</span>
            </div>
            <div class="project-card__meta">
              <span class="project-card__id">${esc(p.id)}</span>
              <span class="project-card__status status--${esc(p.status ?? 'draft')}">${esc(p.status ?? 'draft')}</span>
            </div>
            <div class="project-card__actions">
              <a class="btn btn--primary btn--sm" href="#/projects/${encodeURIComponent(p.id)}">Open</a>
              <button class="btn btn--danger btn--sm project-delete-btn" data-id="${esc(p.id)}" data-title="${esc(p.title)}">Delete</button>
            </div>
          </div>`).join('')}
      </div>`;

    document.querySelectorAll('.project-delete-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const title = btn.dataset.title;
        if (confirm(`Delete project "${title}"? This cannot be undone.`)) {
          deleteProject(id);
        }
      });
    });
  }

  async function deleteProject(id) {
    try {
      await api.deleteProject(id);
      toasts.success('Project deleted', 'The project was removed.');
      loadProjects();
    } catch (err) {
      toasts.error('Delete failed', err instanceof Error ? err.message : String(err));
    }
  }

  return () => {};
}
