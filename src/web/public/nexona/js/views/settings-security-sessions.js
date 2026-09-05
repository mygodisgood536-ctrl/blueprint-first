/**
 * Session management view.
 *
 * Backend contract (src/web/auth-api.ts):
 *   GET  /api/account/sessions              -> { sessions: [{ createdAt, expiresAt, current }] }
 *          (tokens never returned; `current` flags this browser's session)
 *   POST /api/account/sessions/revoke-others -> { revoked }  (keeps this session)
 */
import { api } from '../api.js';
import { router } from '../router.js';
import { toasts } from '../ui/toast.js';

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function fmt(iso) {
  try { return new Date(iso).toLocaleString(); } catch { return '—'; }
}

export function mount(params, account) {
  const content = document.querySelector('#app-content');
  if (!content) return;
  if (!account) { router.go('/login'); return () => {}; }

  content.innerHTML = `
    <div class="page">
      <header class="page__header">
        <div>
          <a class="link" href="#/settings/security">&larr; Security</a>
          <h1 class="page__title">Sessions</h1>
          <p class="page__subtitle">Signed-in devices. Sessions expire automatically after 7 days.</p>
        </div>
      </header>

      <section class="panel">
        <h2 class="panel__title">Active sessions</h2>
        <div class="panel__body" id="sessions-body">
          <div class="skeleton skeleton--text" style="width:60%"></div>
          <div class="skeleton skeleton--text" style="width:40%"></div>
        </div>
      </section>

      <section class="panel">
        <h2 class="panel__title">Other sessions</h2>
        <div class="panel__body">
          <p class="muted" style="margin-top:0">Signs out every session except this one. Use if you suspect another device is signed in as you.</p>
          <button class="btn btn--primary" id="revoke-btn" type="button">
            <span class="btn__text">Revoke other sessions</span>
            <span class="btn__spinner" aria-hidden="true"></span>
          </button>
        </div>
      </section>
    </div>
  `;

  document.body.classList.add('main-app');

  loadSessions().catch((err) => {
    if (err?.status === 401) return;
    const body = document.getElementById('sessions-body');
    if (body) {
      body.innerHTML = `
        <div class="error-state">
          <div class="error-state__icon">&#9888;&#65039;</div>
          <h3 class="error-state__title">Could not load sessions</h3>
          <div class="error-state__action"><button class="btn btn--primary" id="sess-retry">Retry</button></div>
        </div>`;
      document.getElementById('sess-retry')?.addEventListener('click', () => router.go('/settings/security/sessions'));
    }
    void err;
  });

  wireRevoke();
  return () => {};
}

async function loadSessions() {
  const body = document.getElementById('sessions-body');
  if (!body) return;
  const { sessions } = await api.listSessions();
  if (!sessions || sessions.length === 0) {
    body.innerHTML = `
      <div class="empty-state">
        <div class="empty-state__icon">📭</div>
        <h3 class="empty-state__title">No active sessions</h3>
        <p class="empty-state__desc">This should not normally happen while you are signed in.</p>
      </div>`;
    return;
  }
  body.innerHTML = `
    <table class="table">
      <thead><tr class="table__row--header">
        <th class="table__header">Started</th>
        <th class="table__header">Expires</th>
        <th class="table__header">This device</th>
      </tr></thead>
      <tbody>
        ${sessions.map((s) => `
          <tr class="table__row">
            <td class="table__cell">${esc(fmt(s.createdAt))}</td>
            <td class="table__cell">${esc(fmt(s.expiresAt))}</td>
            <td class="table__cell">${s.current ? '<span class="badge badge--success">This device</span>' : '<span class="badge badge--neutral">Other</span>'}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

function wireRevoke() {
  const btn = document.getElementById('revoke-btn');
  btn?.addEventListener('click', () => {
    if (btn.dataset.confirming !== 'true') {
      // Dangerous action: require a second, explicit confirmation.
      btn.dataset.confirming = 'true';
      btn.querySelector('.btn__text').textContent = 'Click again to confirm';
      btn.classList.add('btn--danger');
      setTimeout(() => {
        if (btn.isConnected && btn.dataset.confirming === 'true') {
          btn.dataset.confirming = 'false';
          btn.querySelector('.btn__text').textContent = 'Revoke other sessions';
          btn.classList.remove('btn--danger');
        }
      }, 5000);
      return;
    }
    btn.dataset.confirming = 'false';
    btn.disabled = true;
    btn.classList.add('btn--loading');
    api.revokeOtherSessions()
      .then(({ revoked }) => {
        toasts.success('Sessions revoked', `${revoked} other session${revoked === 1 ? '' : 's'} signed out.`);
        return loadSessions();
      })
      .catch((err) => {
        if (err?.status === 401) return;
        toasts.error('Revoke failed', err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        btn.disabled = false;
        btn.classList.remove('btn--loading');
      });
  });
}