/**
 * Profile view — real account data from the authenticated session.
 *
 * Backend contract:
 *   - Display: router.account (resolved from GET /api/me by the router)
 *   - Update:  POST /api/account/profile { displayName } -> { account }
 */
import { api } from '../api.js';
import { router } from '../router.js';
import { toasts } from '../ui/toast.js';

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function mount(params, account) {
  const content = document.querySelector('#app-content');
  if (!content) return;
  if (!account) { router.go('/login'); return () => {}; }

  const created = account.createdAt ? new Date(account.createdAt).toLocaleDateString() : '—';

  content.innerHTML = `
    <div class="page">
      <header class="page__header">
        <div>
          <h1 class="page__title">Profile</h1>
          <p class="page__subtitle">Your NEXORA account.</p>
        </div>
      </header>

      <section class="panel">
        <h2 class="panel__title">Account</h2>
        <div class="panel__body">
          <div class="account-meta">
            <div class="account-meta__row"><span class="account-meta__label">Username</span><span class="account-meta__value">${esc(account.username)}</span></div>
            <div class="account-meta__row"><span class="account-meta__label">Role</span><span class="account-meta__value">${esc(account.role)}</span></div>
            <div class="account-meta__row"><span class="account-meta__label">Member since</span><span class="account-meta__value">${esc(created)}</span></div>
          </div>
        </div>
      </section>

      <section class="panel">
        <h2 class="panel__title">Display name</h2>
        <div class="panel__body">
          <form class="form" id="profile-form" style="max-width:420px">
            <div class="form-group">
              <label class="form-label" for="display-name">Display name</label>
              <input class="form-input" type="text" id="display-name" name="displayName"
                     required minlength="1" maxlength="80" value="${esc(account.displayName)}">
              <div class="form-hint">Shown across NEXORA. 1–80 characters.</div>
              <div class="form-error" id="display-name-error"></div>
            </div>
            <div class="form-error form-error--banner" id="profile-error"></div>
            <button class="btn btn--primary" type="submit" id="profile-save">
              <span class="btn__text">Save changes</span>
              <span class="btn__spinner" aria-hidden="true"></span>
            </button>
          </form>
        </div>
      </section>

            <section class="panel">
        <h2 class="panel__title">More</h2>
        <div class="panel__body">
          <a class="link--primary" href="#/settings/security">Security settings &rarr;</a>
          <div class="account-meta__row"><span class="account-meta__label">Authenticator</span>
            <a class="link" href="#/settings/security/authenticator">Manage &rarr;</a></div>
          <div class="account-meta__row"><span class="account-meta__label">Password</span>
            <a class="link" href="#/settings/security/password">Change &rarr;</a></div>
          <div class="account-meta__row"><span class="account-meta__label">Sessions</span>
            <a class="link" href="#/settings/security/sessions">Manage &rarr;</a></div>
          <div class="account-meta__row"><span class="account-meta__label">Security activity</span>
            <a class="link" href="#/settings/security/events">View log &rarr;</a></div>
          <div class="account-meta__row"><span class="account-meta__label">Preferences</span>
            <a class="link" href="#/settings/preferences">Account preferences &rarr;</a></div>
        </div>
      </section>
    </div>
  `;

  document.body.classList.add('main-app');

  const form = document.getElementById('profile-form');
  const saveBtn = document.getElementById('profile-save');
  const nameError = document.getElementById('display-name-error');
  const formError = document.getElementById('profile-error');

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    nameError.textContent = '';
    formError.textContent = '';

    const displayName = form.displayName.value.trim();
    if (displayName.length < 1 || displayName.length > 80) {
      nameError.textContent = 'Display name is required (max 80 characters).';
      return;
    }

    saveBtn.disabled = true;
    saveBtn.classList.add('btn--loading');

    try {
      const { account: updated } = await api.updateProfile({ displayName });
      if (router.account) router.account.displayName = updated.displayName;
      toasts.success('Profile updated', 'Your display name was saved.');
      window.dispatchEvent(new CustomEvent('nexona:account-changed'));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (err?.status === 400) nameError.textContent = msg;
      else if (err?.status === 401) return; // global handler redirects
      else formError.textContent = msg;
    } finally {
      saveBtn.disabled = false;
      saveBtn.classList.remove('btn--loading');
    }
  });

  return () => {};
}