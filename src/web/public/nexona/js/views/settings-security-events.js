/**
 * Security events view — append-only account activity log.
 *
 * Backend contract (src/web/auth-api.ts):
 *   GET /api/account/security-events -> { events: [{ type, at, detail? }] }
 * Events are recorded by the backend (login, logout, password.changed,
 * authenticator.enabled, session.revoked_others, ...) — never by the frontend.
 */
import { api } from '../api.js';
import { router } from '../router.js';

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function fmt(iso) {
  try { return new Date(iso).toLocaleString(); } catch { return '—'; }
}

const LABELS = {
  'account.created': 'Account created',
  'session.login': 'Signed in',
  'session.logout': 'Signed out',
  'session.revoked_others': 'Revoked other sessions',
  'password.changed': 'Password changed',
  'password.recovered': 'Password recovered',
  'authenticator.setup': 'Authenticator setup started',
  'authenticator.enabled': 'Authenticator enabled',
  'authenticator.disabled': 'Authenticator disabled',
  'authenticator.recovered': 'Recovered via authenticator',
};

export function mount(params, account) {
  const content = document.querySelector('#app-content');
  if (!content) return;
  if (!account) { router.go('/login'); return () => {}; }

  content.innerHTML = `
    <div class="page">
      <header class="page__header">
        <div>
          <a class="link" href="#/settings/security">&larr; Security</a>
          <h1 class="page__title">Security activity</h1>
          <p class="page__subtitle">Recorded by the NEXORA backend for your account.</p>
        </div>
      </header>

      <section class="panel">
        <div class="panel__body" id="events-body">
          <div class="skeleton skeleton--text" style="width:70%"></div>
          <div class="skeleton skeleton--text" style="width:55%"></div>
          <div class="skeleton skeleton--text" style="width:60%"></div>
        </div>
      </section>
    </div>
  `;

  document.body.classList.add('main-app');

  loadEvents().catch((err) => {
    if (err?.status === 401) return;
    const body = document.getElementById('events-body');
    if (body) {
      body.innerHTML = `
        <div class="error-state">
          <div class="error-state__icon">&#9888;&#65039;</div>
          <h3 class="error-state__title">Could not load security activity</h3>
          <p class="error-state__desc">${esc(err.message || 'Check your connection and try again.')}</p>
          <div class="error-state__action"><button class="btn btn--primary" id="events-retry">Retry</button></div>
        </div>`;
      document.getElementById('events-retry')?.addEventListener('click', () => router.go('/settings/security/events'));
    }
    void err;
  });

  return () => {};
}

async function loadEvents() {
  const body = document.getElementById('events-body');
  if (!body) return;
  const { events } = await api.securityEvents();
  if (!events || events.length === 0) {
    body.innerHTML = `
      <div class="empty-state">
        <div class="empty-state__icon">🗂️</div>
        <h3 class="empty-state__title">No security activity yet</h3>
        <p class="empty-state__desc">Sign-ins and security changes will appear here.</p>
      </div>`;
    return;
  }
  body.innerHTML = `
    <table class="table">
      <thead><tr class="table__row--header">
        <th class="table__header">When</th>
        <th class="table__header">Event</th>
        <th class="table__header">Detail</th>
      </tr></thead>
      <tbody>
        ${events.map((ev) => `
          <tr class="table__row">
            <td class="table__cell">${esc(fmt(ev.at))}</td>
            <td class="table__cell">${esc(LABELS[ev.kind] ?? ev.kind)}</td>
            <td class="table__cell">${ev.detail ? esc(ev.detail) : '—'}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}