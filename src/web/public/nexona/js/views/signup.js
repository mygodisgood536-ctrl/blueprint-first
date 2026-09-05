/**
 * Signup view — real account creation with validation.
 */
import { api } from '../api.js';
import { router } from '../router.js';
import { toasts } from '../ui/toast.js';

export function mount(params, account) {
  const content = document.querySelector('#app-content');
  if (!content) return;

  content.innerHTML = `
    <section class="auth-page">
      <div class="container auth-page__container">
        <div class="auth-card">
                    <div class="auth-card__brand">
            <img src="/nexona/img/logo-icon.svg" alt="" class="auth-card__logo" width="32" height="32" />
          </div>
          <h1 class="auth-card__title">Create your account</h1>
          <p class="auth-card__subtitle">Start engineering software with evidence and precision.</p>

          <form class="form" id="signup-form">
            <div class="form-group">
              <label class="form-label" for="username">Username</label>
              <input class="form-input" type="text" id="username" name="username"
                     autocomplete="username" required minlength="3" maxlength="32"
                     pattern="[a-zA-Z0-9_-]+">
              <div class="form-hint">3–32 characters: letters, numbers, hyphens, underscores.</div>
              <div class="form-error" id="username-error"></div>
            </div>

            <div class="form-group">
              <label class="form-label" for="display-name">Display Name</label>
              <input class="form-input" type="text" id="display-name" name="displayName"
                     required minlength="1" maxlength="80">
              <div class="form-error" id="display-name-error"></div>
            </div>

            <div class="form-group">
              <label class="form-label" for="password">Password</label>
              <input class="form-input" type="password" id="password" name="password"
                     autocomplete="new-password" required minlength="8">
              <div class="form-hint">At least 8 characters. Must include a letter and a number.</div>
              <div class="form-error" id="password-error"></div>
            </div>

            <div class="form-group">
              <label class="form-label" for="password-confirm">Confirm Password</label>
              <input class="form-input" type="password" id="password-confirm" name="passwordConfirm"
                     autocomplete="new-password" required minlength="8">
              <div class="form-error" id="password-confirm-error"></div>
            </div>

            <div class="form-error form-error--banner" id="form-error"></div>

            <button class="btn btn--primary btn--block" type="submit" id="submit-btn">
              <span class="btn__text">Create Account</span>
              <span class="btn__spinner" aria-hidden="true"></span>
            </button>
          </form>

          <div class="auth-card__actions">
            <span class="auth-card__divider">or</span>
            <a href="#/login" class="link--primary">Log in to existing account</a>
          </div>
        </div>
      </div>
    </section>
  `;

  const form = document.getElementById('signup-form');
  const submitBtn = document.getElementById('submit-btn');
  const usernameError = document.getElementById('username-error');
  const displayNameError = document.getElementById('display-name-error');
  const passwordError = document.getElementById('password-error');
  const passwordConfirmError = document.getElementById('password-confirm-error');
  const formError = document.getElementById('form-error');

  function validatePassword(pw) {
    if (pw.length < 8) return 'At least 8 characters.';
    if (!/[a-zA-Z]/.test(pw)) return 'Must include a letter.';
    if (!/[0-9]/.test(pw)) return 'Must include a number.';
    return null;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    usernameError.textContent = '';
    displayNameError.textContent = '';
    passwordError.textContent = '';
    passwordConfirmError.textContent = '';
    formError.textContent = '';

    const username = form.username.value.trim();
    const displayName = form.displayName.value.trim();
    const password = form.password.value;
    const passwordConfirm = form['password-confirm'].value;

    let valid = true;
    if (username.length < 3 || username.length > 32) {
      usernameError.textContent = 'Username must be 3–32 characters.';
      valid = false;
    }
    if (displayName.length < 1 || displayName.length > 80) {
      displayNameError.textContent = 'Display name is required.';
      valid = false;
    }
    const pwError = validatePassword(password);
    if (pwError) {
      passwordError.textContent = pwError;
      valid = false;
    }
    if (password !== passwordConfirm) {
      passwordConfirmError.textContent = 'Passwords do not match.';
      valid = false;
    }
    if (!valid) return;

    submitBtn.disabled = true;
    submitBtn.classList.add('btn--loading');

    try {
      const { account } = await api.signup({ username, password, displayName });
      toasts.success('Account created', `Welcome, ${account.displayName || username}!`);
      router.account = account;
      window.dispatchEvent(new CustomEvent('nexona:account-changed'));
      router.go('/dashboard');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (err.status === 409) {
        usernameError.textContent = msg;
      } else if (err.status === 400) {
        formError.textContent = msg;
      } else {
        toasts.error('Signup failed', msg);
      }
    } finally {
      submitBtn.disabled = false;
      submitBtn.classList.remove('btn--loading');
    }
  });

  document.body.classList.remove('main-app');
  return () => {};
}
