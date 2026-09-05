/**
 * Security Center — the hub for all account security.
 *
 * Every value shown comes from a real backend read:
 *   - account info: router.account (resolved from /api/me session)
 *   - authenticator: GET /api/account/authenticator -> { enabled, recoveryCodesRemaining }
 *   - sessions: GET /api/account/sessions -> { sessions: [{ createdAt, expiresAt, current }] }
 */
import { api } from '../api.js';
import { router } from '../router.js';

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function mount(params, account) {
  const content = document.querySelector('#app-content');
  if (!content) return;

  content.innerHTML = `
    <div class="page">
      <header class="page__header">
        <div>
          <h1 class="page__title">Security</h1>
          <p class="page__subtitle">Manage your account's protection.</p>
        </div>
      </header>

      <section class="panel" id="security-account">
        <h2 class="panel__title">Account</h2>
        <div class="panel__body" id="account-info">
          <div class="skeleton skeleton--text" style="width:40%"></div>
          <div class="skeleton skeleton--text" style="width:25%"></div>
        </div>
      </section>

      <section class="security-grid" id="security-grid">
        <a class="security-card" href="#/settings/security/authenticator">
          <div class="security-card__title">Authenticator</div>
          <div class="security-card__status" id="auth-status"><span class="skeleton skeleton--text" style="width:80px"></span></div>
          <div class="security-card__action">Manage &rarr;</div>
        </a>

        <a class="security-card" href="#/settings/security/password">
          <div class="security-card__title">Password</div>
          <div class="security-card__status">Protects all your sessions</div>
          <div class="security-card__action">Change password &rarr;</div>
        </a>

        <a class="security-card" href="#/settings/security/sessions">
          <div class="security-card__title">Sessions</div>
          <div class="security-card__status" id="session-status"><span class="skeleton skeleton--text" style="width:100px"></span></div>
          <div class="security-card__action">Manage sessions &rarr;</div>
        </a>

        <a class="security-card" href="#/settings/security/events">
          <div class="security-card__title">Security activity</div>
          <div class="security-card__status">Logins, password changes, authenticator changes</div>
          <div class="security-card__action">View log &rarr;</div>
        </a>
      </section>
    </div>
  `;

  document.body.classList.add('main-app');

  loadSecurity().catch((err) => {
    if (err?.status === 401) return; // global handler redirects to login
    const grid = document.getElementById('security-grid');
    if (grid) {
      grid.innerHTML = `
        <div class="error-state" style="grid-column: 1 / -1;">
          <div class="error-state__icon">&#9888;&#65039;</div>
          <h3 class="error-state__title">Could not load security status</h3>
          <p class="error-state__desc">Check your connection and try again.</p>
          <div class="error-state__action"><button class="btn btn--primary" id="security-retry">Retry</button></div>
        </div>`;
      document.getElementById('security-retry')?.addEventListener('click', () => router.go('/settings/security'));
    }
    void err;
  });

  return () => {};
}

async function loadSecurity() {
  const [authRes, sessionsRes] = await Promise.allSettled([
    api.authenticatorStatus(),
    api.listSessions(),
  ]);

  // Account info (from session; already verified by router guard)
  const accountInfo = document.getElementById('account-info');
  const account = router.account;
  if (accountInfo && account) {
    const created = account.createdAt ? new Date(account.createdAt).toLocaleDateString() : null;
    accountInfo.innerHTML = `
      <div class="account-meta">
        <div class="account-meta__row"><span class="account-meta__label">Display name</span><span class="account-meta__value">${esc(account.displayName)}</span></div>
        <div class="account-meta__row"><span class="account-meta__label">Username</span><span class="account-meta__value">${esc(account.username)}</span></div>
        <div class="account-meta__row"><span class="account-meta__label">Role</span><span class="account-meta__value">${esc(account.role)}</span></div>
        ${created ? `<div class="account-meta__row"><span class="account-meta__label">Member since</span><span class="account-meta__value">${esc(created)}</span></div>` : ''}
      </div>`;
  }

  // Authenticator status (real backend state)
  const authStatus = document.getElementById('auth-status');
  if (authStatus) {
    if (authRes.status === 'fulfilled') {
      const { enabled, recoveryCodesRemaining } = authRes.value;
      authStatus.innerHTML = enabled
        ? `<span class="badge badge--success">Enabled</span> <span class="muted">${recoveryCodesRemaining} recovery code${recoveryCodesRemaining === 1 ? '' : 's'} remaining</span>`
        : '<span class="badge badge--warning">Not set up</span>';
    } else {
      authStatus.innerHTML = '<span class="badge badge--neutral">Unknown</span>';
    }
  }

  // Session status (real backend state)
  const sessionStatus = document.getElementById('session-status');
  if (sessionStatus) {
    if (sessionsRes.status === 'fulfilled') {
      const sessions = sessionsRes.value.sessions ?? [];
      const others = sessions.filter((s) => !s.current).length;
      sessionStatus.innerHTML = `<span class="badge badge--info">${sessions.length} active</span>${others > 0 ? ` <span class="muted">${others} on other device${others === 1 ? '' : 's'}</span>` : ''}`;
    } else {
      sessionStatus.innerHTML = '<span class="badge badge--neutral">Unknown</span>';
    }
  }
}