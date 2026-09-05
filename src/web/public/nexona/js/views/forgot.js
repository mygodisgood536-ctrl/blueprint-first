/**
 * Forgot-password view — authenticator-gated recovery when the account has the
 * authenticator enabled; otherwise the honest local one-time token flow.
 *
 * Backend contract:
 *   POST /api/auth/forgot { username }
 *     -> { mode: 'authenticator', challengeId, expiresAt }
 *     -> { mode: 'local-token', resetToken, notice }
 *     -> 404 { error, notice }
 *   POST /api/auth/forgot/verify { challengeId, code, newPassword }  (authenticator path)
 *   POST /api/auth/reset { token, password }                          (local-token path)
 */
import { api } from '../api.js';
import { router } from '../router.js';
import { toasts } from '../ui/toast.js';

const HTML1 = `
<section class="auth-page">
  <div class="container auth-page__container">
    <div class="auth-card">
      <div class="auth-card__brand">
        <div class="logo">NEXORA</div>
      </div>
      <h1 class="auth-card__title">Reset your password</h1>

      <div id="step-username" class="step">
        <p class="auth-card__subtitle">
          Enter your username to begin recovery. Accounts protected by the
          authenticator recover through it.
        </p>

        <form class="form" id="forgot-form">
          <div class="form-group">
            <label class="form-label" for="username">Username</label>
            <input class="form-input" type="text" id="username" name="username"
                   required minlength="3" maxlength="32" autocomplete="username">
            <div class="form-error" id="username-error"></div>
          </div>

          <div class="form-error form-error--banner" id="form-error"></div>

          <button class="btn btn--primary btn--block" type="submit" id="submit-btn">
            <span class="btn__text">Continue</span>
            <span class="btn__spinner" aria-hidden="true"></span>
          </button>
        </form>
      </div>
`;
const HTML2 = `
      <div id="step-authenticator" class="step" style="display:none;">
        <p class="auth-card__subtitle">
          This account is protected by the authenticator. Enter the 6-digit code
          from your authenticator app and choose a new password.
        </p>

        <form class="form" id="auth-recovery-form">
          <input type="hidden" name="challengeId" id="challenge-id">

          <div class="form-group">
            <label class="form-label" for="auth-code">Authenticator code</label>
            <input class="form-input" type="text" id="auth-code" name="code"
                   inputmode="numeric" autocomplete="one-time-code" required
                   minlength="6" maxlength="6" pattern="[0-9]{6}">
            <div class="form-hint">6 digits from your authenticator app.</div>
            <div class="form-error" id="auth-code-error"></div>
          </div>

          <div class="form-group">
            <label class="form-label" for="auth-new-password">New Password</label>
            <input class="form-input" type="password" id="auth-new-password" name="newPassword"
                   autocomplete="new-password" required minlength="8">
            <div class="form-hint">At least 8 characters. Must include a letter and a number.</div>
            <div class="form-error" id="auth-password-error"></div>
          </div>

          <div class="form-group">
            <label class="form-label" for="auth-password-confirm">Confirm New Password</label>
            <input class="form-input" type="password" id="auth-password-confirm" name="passwordConfirm"
                   autocomplete="new-password" required minlength="8">
            <div class="form-error" id="auth-password-confirm-error"></div>
          </div>

          <div class="form-error form-error--banner" id="auth-form-error"></div>

          <button class="btn btn--primary btn--block" type="submit" id="auth-recovery-btn">
            <span class="btn__text">Recover Account</span>
            <span class="btn__spinner" aria-hidden="true"></span>
          </button>
        </form>
      </div>

      <div id="step-token" class="step" style="display:none;">
        <p class="auth-card__subtitle">
          A one-time reset token has been generated.
        </p>
        <p class="auth-card__note">
          <strong>Note:</strong> This local deployment has no email service
          configured, so the token is displayed here instead of emailed.
        </p>

        <div class="token-display">
          <code id="reset-token" class="token"></code>
          <button class="btn btn--icon btn--sm" id="copy-token" aria-label="Copy token">
            <span class="btn__icon">📋</span>
          </button>
        </div>

        <form class="form" id="reset-form">
          <input type="hidden" name="token" id="token-input">

          <div class="form-group">
            <label class="form-label" for="new-password">New Password</label>
            <input class="form-input" type="password" id="new-password" name="newPassword"
                   autocomplete="new-password" required minlength="8">
            <div class="form-hint">At least 8 characters. Must include a letter and a number.</div>
            <div class="form-error" id="password-error"></div>
          </div>

          <div class="form-group">
            <label class="form-label" for="password-confirm">Confirm New Password</label>
            <input class="form-input" type="password" id="password-confirm" name="passwordConfirm"
                   autocomplete="new-password" required minlength="8">
            <div class="form-error" id="password-confirm-error"></div>
          </div>

          <div class="form-error form-error--banner" id="reset-error"></div>

          <button class="btn btn--primary btn--block" type="submit" id="reset-btn">
            <span class="btn__text">Reset Password</span>
            <span class="btn__spinner" aria-hidden="true"></span>
          </button>
        </form>
      </div>

      <div class="auth-card__actions">
        <a href="#/login" class="link--primary">Back to login</a>
      </div>
    </div>
  </div>
</section>
`;

const HTML = HTML1 + HTML2;

function validatePassword(pw) {
  if (pw.length < 8) return 'At least 8 characters.';
  if (!/[a-zA-Z]/.test(pw)) return 'Must include a letter.';
  if (!/[0-9]/.test(pw)) return 'Must include a number.';
  return null;
}
export function mount(params, account) {
  const content = document.querySelector('#app-content');
  if (!content) return;

  content.innerHTML = HTML;

  const stepUsername = document.getElementById('step-username');
  const stepAuthenticator = document.getElementById('step-authenticator');
  const stepToken = document.getElementById('step-token');
  const formError = document.getElementById('form-error');

  // Step 1: identify the account
  document.getElementById('forgot-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    formError.textContent = '';
    document.getElementById('username-error').textContent = '';
    const username = e.target.username.value.trim();
    if (username.length < 3) {
      document.getElementById('username-error').textContent = 'Username is required.';
      return;
    }

    const submitBtn = document.getElementById('submit-btn');
    submitBtn.disabled = true;
    submitBtn.classList.add('btn--loading');

    try {
      const result = await api.forgot({ username });
      if (result.mode === 'authenticator') {
        document.getElementById('challenge-id').value = result.challengeId;
        stepUsername.style.display = 'none';
        stepAuthenticator.style.display = 'block';
        toasts.info('Authenticator required', 'Enter your authenticator code to continue.');
      } else if (result.mode === 'local-token') {
        document.getElementById('reset-token').textContent = result.resetToken;
        document.getElementById('token-input').value = result.resetToken;
        stepUsername.style.display = 'none';
        stepToken.style.display = 'block';
        toasts.info('Token generated', result.notice || 'A reset token has been created.');
      }
    } catch (err) {
      formError.textContent = err instanceof Error ? err.message : String(err);
    } finally {
      submitBtn.disabled = false;
      submitBtn.classList.remove('btn--loading');
    }
  });

  // Copy token button
  document.getElementById('copy-token').addEventListener('click', () => {
    const token = document.getElementById('reset-token').textContent;
    navigator.clipboard.writeText(token).then(() => {
      toasts.success('Copied', 'Reset token copied to clipboard.');
    });
  });

  // Step 2a: authenticator recovery (verify code + set new password)
  document.getElementById('auth-recovery-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const authFormError = document.getElementById('auth-form-error');
    authFormError.textContent = '';
    document.getElementById('auth-code-error').textContent = '';
    document.getElementById('auth-password-error').textContent = '';
    document.getElementById('auth-password-confirm-error').textContent = '';

    const challengeId = document.getElementById('challenge-id').value;
    const code = e.target.code.value.trim();
    const password = e.target.newPassword.value;
    const confirm = e.target.passwordConfirm.value;

    let valid = true;
    if (!/^[0-9]{6}$/.test(code)) {
      document.getElementById('auth-code-error').textContent = 'Enter the 6-digit code.';
      valid = false;
    }
    const pwErr = validatePassword(password);
    if (pwErr) {
      document.getElementById('auth-password-error').textContent = pwErr;
      valid = false;
    }
    if (password !== confirm) {
      document.getElementById('auth-password-confirm-error').textContent = 'Passwords do not match.';
      valid = false;
    }
    if (!valid) return;

    const btn = document.getElementById('auth-recovery-btn');
    btn.disabled = true;
    btn.classList.add('btn--loading');

    try {
      await api.forgotVerify({ challengeId, code, newPassword: password });
      toasts.success('Recovery complete', 'Your password was reset. Please log in.');
      router.go('/login');
    } catch (err) {
      authFormError.textContent = err instanceof Error ? err.message : String(err);
    } finally {
      btn.disabled = false;
      btn.classList.remove('btn--loading');
    }
  });

  // Step 2b: local-token reset
  document.getElementById('reset-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const resetError = document.getElementById('reset-error');
    resetError.textContent = '';
    document.getElementById('password-error').textContent = '';
    document.getElementById('password-confirm-error').textContent = '';

    const token = document.getElementById('token-input').value;
    const password = e.target.newPassword.value;
    const confirm = e.target.passwordConfirm.value;

    let valid = true;
    const pwErr = validatePassword(password);
    if (pwErr) {
      document.getElementById('password-error').textContent = pwErr;
      valid = false;
    }
    if (password !== confirm) {
      document.getElementById('password-confirm-error').textContent = 'Passwords do not match.';
      valid = false;
    }
    if (!valid) return;

    const resetBtn = document.getElementById('reset-btn');
    resetBtn.disabled = true;
    resetBtn.classList.add('btn--loading');

    try {
      await api.reset({ token, password });
      toasts.success('Password reset', 'Your password has been reset. Please log in.');
      router.go('/login');
    } catch (err) {
      resetError.textContent = err instanceof Error ? err.message : String(err);
    } finally {
      resetBtn.disabled = false;
      resetBtn.classList.remove('btn--loading');
    }
  });

  document.body.classList.remove('main-app');
  return () => {};
}