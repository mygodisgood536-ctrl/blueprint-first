/**
 * Change password view.
 *
 * Backend contract (src/web/auth-api.ts):
 *   POST /api/account/password { currentPassword, newPassword }
 *     -> 200 { account }                       (current session stays valid)
 *     -> 400 missing fields / weak new password
 *     -> 401 wrong current password / no session
 *   Security event 'password.changed' recorded by the backend.
 */
import { api } from '../api.js';
import { router } from '../router.js';
import { toasts } from '../ui/toast.js';

function validateNewPassword(pw) {
  if (pw.length < 8) return 'At least 8 characters.';
  if (!/[a-zA-Z]/.test(pw)) return 'Must include a letter.';
  if (!/[0-9]/.test(pw)) return 'Must include a number.';
  return null;
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
          <h1 class="page__title">Change password</h1>
          <p class="page__subtitle">Your current session stays active; other sessions are not affected.</p>
        </div>
      </header>

      <section class="panel">
        <div class="panel__body">
          <form class="form" id="password-form" style="max-width:420px">
            <div class="form-group">
              <label class="form-label" for="current-password">Current password</label>
              <input class="form-input" type="password" id="current-password" name="currentPassword"
                     autocomplete="current-password" required>
              <div class="form-error" id="current-password-error"></div>
            </div>

            <div class="form-group">
              <label class="form-label" for="new-password">New password</label>
              <input class="form-input" type="password" id="new-password" name="newPassword"
                     autocomplete="new-password" required minlength="8">
              <div class="form-hint">At least 8 characters. Must include a letter and a number.</div>
              <div class="form-error" id="new-password-error"></div>
            </div>

            <div class="form-group">
              <label class="form-label" for="new-password-confirm">Confirm new password</label>
              <input class="form-input" type="password" id="new-password-confirm" name="newPasswordConfirm"
                     autocomplete="new-password" required minlength="8">
              <div class="form-error" id="confirm-error"></div>
            </div>

            <div class="form-error form-error--banner" id="form-error"></div>

            <button class="btn btn--primary" type="submit" id="submit-btn">
              <span class="btn__text">Change password</span>
              <span class="btn__spinner" aria-hidden="true"></span>
            </button>
          </form>
        </div>
      </section>
    </div>
  `;

  document.body.classList.add('main-app');

  const form = document.getElementById('password-form');
  const submitBtn = document.getElementById('submit-btn');
  const currentError = document.getElementById('current-password-error');
  const newError = document.getElementById('new-password-error');
  const confirmError = document.getElementById('confirm-error');
  const formError = document.getElementById('form-error');

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    currentError.textContent = '';
    newError.textContent = '';
    confirmError.textContent = '';
    formError.textContent = '';

    const currentPassword = form.currentPassword.value;
    const newPassword = form.newPassword.value;
    const confirm = form.newPasswordConfirm.value;

    let valid = true;
    if (!currentPassword) {
      currentError.textContent = 'Enter your current password.';
      valid = false;
    }
    const pwErr = validateNewPassword(newPassword);
    if (pwErr) {
      newError.textContent = pwErr;
      valid = false;
    }
    if (newPassword === currentPassword && currentPassword) {
      newError.textContent = 'New password must differ from the current one.';
      valid = false;
    }
    if (newPassword !== confirm) {
      confirmError.textContent = 'Passwords do not match.';
      valid = false;
    }
    if (!valid) return;

    submitBtn.disabled = true;
    submitBtn.classList.add('btn--loading');

    try {
      await api.changePassword({ currentPassword, newPassword });
      toasts.success('Password changed', 'Use your new password next time you log in.');
      router.go('/settings/security');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (err?.status === 401 && router.account) formError.textContent = msg || 'Current password is incorrect.';
      else if (err?.status === 400) formError.textContent = msg;
      else if (err?.status === 401) return; // session gone -> global handler
      else formError.textContent = msg;
    } finally {
      submitBtn.disabled = false;
      submitBtn.classList.remove('btn--loading');
    }
  });

  return () => {};
}