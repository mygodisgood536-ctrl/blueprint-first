/**
 * Login view — real authentication with validation and error states.
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
          <h1 class="auth-card__title">Welcome back</h1>
          <p class="auth-card__subtitle">Log in to continue your engineering work.</p>

          <form class="form" id="login-form">
            <div class="form-group">
              <label class="form-label" for="username">Username</label>
              <input class="form-input" type="text" id="username" name="username"
                     autocomplete="username" required minlength="3" maxlength="32"
                     pattern="[a-zA-Z0-9_-]+">
              <div class="form-hint">3–32 characters: letters, numbers, hyphens, underscores.</div>
              <div class="form-error" id="username-error"></div>
            </div>

            <div class="form-group">
              <label class="form-label" for="password">Password</label>
              <input class="form-input" type="password" id="password" name="password"
                     autocomplete="current-password" required minlength="8">
              <div class="form-error" id="password-error"></div>
            </div>

            <div class="form-error form-error--banner" id="form-error"></div>

            <button class="btn btn--primary btn--block" type="submit" id="submit-btn">
              <span class="btn__text">Log In</span>
              <span class="btn__spinner" aria-hidden="true"></span>
            </button>
          </form>

          <div class="auth-card__actions">
            <div class="auth-card__row">
              <a href="#/forgot" class="link">Forgot password?</a>
              <span class="auth-card__divider">or</span>
              <a href="#/signup" class="link--primary">Create account</a>
            </div>
          </div>
        </div>
      </div>
    </section>
  `;

  const form = document.getElementById('login-form');
  const submitBtn = document.getElementById('submit-btn');
  const usernameError = document.getElementById('username-error');
  const passwordError = document.getElementById('password-error');
  const formError = document.getElementById('form-error');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Reset errors
    usernameError.textContent = '';
    passwordError.textContent = '';
    formError.textContent = '';

    const username = form.username.value.trim();
    const password = form.password.value;

    // Client-side validation
    let valid = true;
    if (username.length < 3 || username.length > 32) {
      usernameError.textContent = 'Username must be 3–32 characters.';
      valid = false;
    }
    if (password.length < 8) {
      passwordError.textContent = 'Password must be at least 8 characters.';
      valid = false;
    }
    if (!valid) return;

    // Show loading state
    submitBtn.disabled = true;
    submitBtn.classList.add('btn--loading');

    try {
      await api.login({ username, password });
      toasts.success('Welcome back', 'You are now logged in.');
      router.account = (await api.session()).account;
      window.dispatchEvent(new CustomEvent('nexona:account-changed'));
      router.go('/dashboard');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (err.status === 401 || err.status === 400) {
        formError.textContent = msg;
      } else {
        toasts.error('Login failed', msg);
      }
    } finally {
      submitBtn.disabled = false;
      submitBtn.classList.remove('btn--loading');
    }
  });

  document.body.classList.remove('main-app');
  return () => {};
}
