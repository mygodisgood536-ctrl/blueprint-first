/**
 * Dashboard view — authenticated control center.
 * Every number comes from a real backend read (session, projects, activity,
 * selection, credentials). No fabricated statistics.
 */
import { api } from '../api.js';
import { router } from '../router.js';
import { toasts } from '../ui/toast.js';

export function mount(params, account) {
  const content = document.querySelector('#app-content');
  if (!content) return;

  content.innerHTML = `
    <div class="page">
      <header class="page__header">
        <div>
          <h1 class="page__title">Welcome back${account?.displayName ? `, ${account.displayName}` : ''}</h1>
          <p class="page__subtitle">Your Blueprint-First engineering control center.</p>
        </div>
        <button class="btn btn--primary" id="new-project-btn">+ New Project</button>
      </header>

      <section class="cards" id="stats-cards">
        <div class="card card--skeleton" aria-hidden="true">Loading…</div>
      </section>

      <section class="split">
        <div class="panel">
          <h2 class="panel__title">Your Projects</h2>
          <div class="panel__body" id="projects-list">
            <p class="muted">Loading projects…</p>
          </div>
        </div>
        <div class="panel">
          <h2 class="panel__title">Recent Activity</h2>
          <div class="panel__body" id="activity-list">
            <p class="muted">Loading activity…</p>
          </div>
        </div>
      </section>

      <section class="panel">
        <h2 class="panel__title">AI Status</h2>
        <div class="panel__body" id="ai-status">
          <p class="muted">Loading AI status…</p>
        </div>
      </section>
    </div>
  `;

  document.getElementById('new-project-btn')?.addEventListener('click', () => router.go('/projects/new'));
  document.body.classList.add('main-app');

  void account;
  void params;
  loadDashboard().catch(() => toasts.error('Dashboard failed', 'Could not load dashboard data.'));
  return () => {};
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

async function loadDashboard() {
  const [projectsRes, activityRes, summaryRes, selectionRes, credsRes] = await Promise.allSettled([
    api.listProjects(),
    api.activity(),
    api.summary(),
    api.getSelection(),
    api.listCredentials(),
  ]);

  // Stats cards
  const statsCards = document.getElementById('stats-cards');
  const projects = projectsRes.status === 'fulfilled' ? projectsRes.value.projects ?? [] : [];
  const evidenceCount = summaryRes.status === 'fulfilled' ? summaryRes.value.evidenceCount : null;
  const certified = summaryRes.status === 'fulfilled' ? summaryRes.value.certified : null;

  if (statsCards) {
    statsCards.innerHTML = `
      <div class="card"><div class="card__value">${projects.length}</div><div class="card__label">Projects</div></div>
      <div class="card"><div class="card__value">${evidenceCount ?? '—'}</div><div class="card__label">Evidence records</div></div>
      <div class="card"><div class="card__value">${certified === null ? '—' : certified ? 'Yes' : 'No'}</div><div class="card__label">Latest blueprint certified</div></div>
      <div class="card"><div class="card__value">${credsRes.status === 'fulfilled' ? (credsRes.value.credentials ?? []).length : '—'}</div><div class="card__label">Provider credentials</div></div>
    `;
  }

  // Projects list
  const projectsList = document.getElementById('projects-list');
  if (projectsList) {
    if (projects.length === 0) {
      projectsList.innerHTML = `
        <div class="empty-state">
          <p>No projects yet.</p>
          <button class="btn btn--primary btn--sm" id="empty-new-project">Create your first project</button>
        </div>`;
      document.getElementById('empty-new-project')?.addEventListener('click', () => router.go('/projects/new'));
    } else {
      projectsList.innerHTML = projects.map((p) => `
        <a class="project-row" href="#/projects/${encodeURIComponent(p.id)}">
          <div class="project-row__title">${esc(p.title)}</div>
          <div class="project-row__meta">${esc(p.id)} · mode: ${esc(p.mode ?? '—')}</div>
        </a>`).join('');
    }
  }

  // Activity list
  const activityList = document.getElementById('activity-list');
  if (activityList) {
    const items = activityRes.status === 'fulfilled' ? activityRes.value.activity ?? [] : [];
    activityList.innerHTML = items.length === 0
      ? '<p class="muted">No recent activity.</p>'
      : `<ul class="activity-list">${items.map((a) => `<li class="activity-item"><span class="activity-item__type">${esc(a.type)}</span> ${esc(a.title)}</li>`).join('')}</ul>`;
  }

  // AI status
  const aiStatus = document.getElementById('ai-status');
  if (aiStatus) {
    const selection = selectionRes.status === 'fulfilled' ? selectionRes.value.selection : null;
    const creds = credsRes.status === 'fulfilled' ? credsRes.value.credentials ?? [] : [];
    const verifiedCreds = creds.filter((c) => c.verified);
    aiStatus.innerHTML = `
      <div class="ai-status-grid">
        <div>
          <strong>Selected model:</strong>
          ${selection?.providerId && selection?.modelId ? `${esc(selection.providerId)} / ${esc(selection.modelId)}` : '<span class="muted">none selected</span>'}
        </div>
        <div>
          <strong>Verified providers:</strong> ${verifiedCreds.length} of ${creds.length}
        </div>
        <div class="ai-status-hint">
          Configure providers and models in <a href="#/providers">Providers</a>. A model is only listed as available after a real connection test.
        </div>
      </div>`;
  }
}