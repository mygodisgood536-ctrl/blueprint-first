/**
 * Authenticator management view.
 *
 * Real backend contracts (src/web/auth-api.ts):
 *   GET  /api/account/authenticator        -> { enabled, recoveryCodesRemaining }
 *   POST /api/account/authenticator/setup  { currentPassword } -> { secret, otpauth }
 *          (403 when current password wrong; secret shown exactly once)
 *   POST /api/account/authenticator/enable { code } -> { enabled: true, recoveryCodes }
 *          (recovery codes returned exactly once, at enablement)
 *   POST /api/account/authenticator/disable { code } -> { enabled: false }
 *
 * The secret is NEVER generated or verified in the browser. Every check is
 * performed by the backend; the UI only displays backend state.
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

  content.innerHTML = `
    <div class="page">
      <header class="page__header">
        <div>
          <a class="link" href="#/settings/security">&larr; Security</a>
          <h1 class="page__title">Authenticator</h1>
          <p class="page__subtitle">Time-based one-time codes (TOTP) verified by the NEXORA backend.</p>
        </div>
      </header>
      <section class="panel"><div class="panel__body" id="auth-body">
        <div class="skeleton skeleton--text" style="width:50%"></div>
        <div class="skeleton skeleton--text" style="width:30%"></div>
      </div></section>
    </div>
  `;

  document.body.classList.add('main-app');

  api.authenticatorStatus()
    .then((status) => renderState(content, status))
    .catch((err) => {
      if (err?.status === 401) return; // global handler
      const body = document.getElementById('auth-body');
      if (body) {
        body.innerHTML = `
          <div class="error-state">
            <div class="error-state__icon">&#9888;&#65039;</div>
            <h3 class="error-state__title">Could not load authenticator status</h3>
            <p class="error-state__desc">${esc(err.message || 'Check your connection and try again.')}</p>
            <div class="error-state__action"><button class="btn btn--primary" id="auth-retry">Retry</button></div>
          </div>`;
        document.getElementById('auth-retry')?.addEventListener('click', () => router.go('/settings/security/authenticator'));
      }
    });

  return () => {};
}

function renderState(content, status) {
  const body = document.getElementById('auth-body');
  if (!body) return;
  if (status.enabled) renderEnabled(body, status);
  else renderSetup(body);
}

// ── Enabled state: show status + disable form ────────────────────────────────
function renderEnabled(body, status) {
  body.innerHTML = `
    <div class="account-meta" style="max-width:420px;margin-bottom:var(--space-lg)">
      <div class="account-meta__row"><span class="account-meta__label">Status</span><span class="account-meta__value"><span class="badge badge--success">Enabled</span></span></div>
      <div class="account-meta__row"><span class="account-meta__label">Recovery codes remaining</span><span class="account-meta__value">${esc(String(status.recoveryCodesRemaining))}</span></div>
    </div>
    <p class="muted" style="max-width:480px">
      Sign-ins from new sessions require a 6-digit code from your authenticator app.
      Recovery with a remaining recovery code also works if you lose the app.
    </p>
    <h3 style="margin:var(--space-lg) 0 var(--space-sm)">Disable authenticator</h3>
    <p class="muted" style="margin-top:0">Requires the current 6-digit code. Your account will no longer require authenticator codes.</p>
    <form class="form" id="disable-form" style="max-width:420px">
      <div class="form-group">
        <label class="form-label" for="disable-code">Authenticator code</label>
        <input class="form-input" type="text" id="disable-code" name="code"
               inputmode="numeric" autocomplete="one-time-code" required
               minlength="6" maxlength="6" pattern="[0-9]{6}">
        <div class="form-error" id="disable-code-error"></div>
      </div>
            <div class="form-error form-error--banner" id="disable-error"></div>
      <button class="btn btn--primary" type="submit" id="disable-btn">
        <span class="btn__text">Disable authenticator</span>
        <span class="btn__spinner" aria-hidden="true"></span>
      </button>
    </form>
  `;
  wireDisable(body);
}

// ── Setup flow (not enabled): password -> secret -> code -> recovery codes ──
function renderSetup(body) {
  body.innerHTML = `
    <div class="badge badge--warning" style="margin-bottom:var(--space-md)">Not set up</div>
    <p class="muted" style="max-width:480px">
      Add a second factor: codes from an authenticator app (Google Authenticator,
      Aegis, 1Password) are verified by the NEXORA backend at every sign-in.
    </p>
    <form class="form" id="setup-form" style="max-width:420px">
      <div class="form-group">
        <label class="form-label" for="setup-password">Current password</label>
        <input class="form-input" type="password" id="setup-password" name="currentPassword"
               autocomplete="current-password" required>
        <div class="form-hint">Required to change authenticator settings.</div>
        <div class="form-error" id="setup-password-error"></div>
      </div>
      <div class="form-error form-error--banner" id="setup-error"></div>
      <button class="btn btn--primary" type="submit" id="setup-btn">
        <span class="btn__text">Begin setup</span>
        <span class="btn__spinner" aria-hidden="true"></span>
      </button>
    </form>
    <div id="setup-enroll"></div>
  `;
  wireSetup(body);
}

function wireSetup(body) {
  const form = body.querySelector('#setup-form');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pwError = body.querySelector('#setup-password-error');
    const formError = body.querySelector('#setup-error');
    pwError.textContent = '';
    formError.textContent = '';
    const currentPassword = form.currentPassword.value;
    if (!currentPassword) { pwError.textContent = 'Enter your current password.'; return; }

    const btn = body.querySelector('#setup-btn');
    btn.disabled = true;
    btn.classList.add('btn--loading');
    try {
      const { secret, otpauth } = await api.setupAuthenticator(currentPassword);
      renderEnroll(body.querySelector('#setup-enroll'), { secret, otpauth });
      form.style.display = 'none';
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (err?.status === 401) return; // session gone
      if (err?.status === 403) pwError.textContent = msg;
      else formError.textContent = msg;
    } finally {
      btn.disabled = false;
      btn.classList.remove('btn--loading');
    }
  });
}

function renderEnroll(container, { secret, otpauth }) {
  container.innerHTML = `
    <h3 style="margin:var(--space-lg) 0 var(--space-sm)">1. Add the secret to your authenticator app</h3>
    <p class="muted" style="margin-top:0">Choose &ldquo;Enter a setup key&rdquo; in your app and paste this secret:</p>
    <div class="secret-display"><code id="auth-secret">${esc(secret)}</code>
      <button class="btn btn--secondary btn--sm" id="copy-secret" type="button">Copy</button>
    </div>
    <p class="muted">App link (if your app handles otpauth links): <a class="link" href="${esc(otpauth)}">open in authenticator</a></p>

    <h3 style="margin:var(--space-lg) 0 var(--space-sm)">2. Verify a code to enable</h3>
    <form class="form" id="enable-form" style="max-width:420px">
      <div class="form-group">
        <label class="form-label" for="enable-code">6-digit code</label>
        <input class="form-input" type="text" id="enable-code" name="code"
               inputmode="numeric" autocomplete="one-time-code" required
               minlength="6" maxlength="6" pattern="[0-9]{6}">
        <div class="form-error" id="enable-code-error"></div>
      </div>
      <div class="form-error form-error--banner" id="enable-error"></div>
      <button class="btn btn--primary" type="submit" id="enable-btn">
        <span class="btn__text">Enable authenticator</span>
        <span class="btn__spinner" aria-hidden="true"></span>
      </button>
    </form>
  `;

  copySecret(container);
  const enableForm = container.querySelector('#enable-form');
  enableForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const codeError = container.querySelector('#enable-code-error');
    const formError = container.querySelector('#enable-error');
    codeError.textContent = '';
    formError.textContent = '';
    const code = enableForm.code.value.trim();
    if (!/^[0-9]{6}$/.test(code)) { codeError.textContent = 'Enter the 6-digit code.'; return; }

    const btn = container.querySelector('#enable-btn');
    btn.disabled = true;
    btn.classList.add('btn--loading');
    try {
      const { recoveryCodes } = await api.enableAuthenticator(code);
      renderRecoveryCodes(container, recoveryCodes);
      toasts.success('Authenticator enabled', 'Save your recovery codes now.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (err?.status === 401) return;
      if (err?.status === 400) codeError.textContent = msg;
      else formError.textContent = msg;
    } finally {
      btn.disabled = false;
      btn.classList.remove('btn--loading');
    }
  });
}

function copySecret(container) {
  container.querySelector('#copy-secret')?.addEventListener('click', () => {
    const secret = container.querySelector('#auth-secret')?.textContent ?? '';
    navigator.clipboard.writeText(secret.trim()).then(() => {
      toasts.success('Copied', 'Secret copied to clipboard.');
    }).catch(() => {
      toasts.error('Copy failed', 'Copy the secret manually.');
    });
  });
}

// ── Recovery codes (returned exactly once, at enablement) ────────────────────
function renderRecoveryCodes(container, recoveryCodes) {
  container.innerHTML = `
    <div class="carepage__note" style="text-align:left">
      <p><strong>Save these recovery codes now.</strong> They are shown only once.
      Each code can be used a single time to regain access if you lose your authenticator.</p>
    </div>
    <div class="recovery-codes" id="recovery-codes">
      ${(recoveryCodes ?? []).map((c) => `<code class="recovery-code">${esc(c)}</code>`).join('')}
    </div>
    <div style="display:flex;gap:var(--space-sm);margin:var(--space-md) 0">
      <button class="btn btn--secondary btn--sm" id="copy-codes" type="button">Copy codes</button>
      <a class="btn btn--primary btn--sm" href="#/settings/security">Back to Security</a>
    </div>
    <p class="muted">The authenticator is now <strong>enabled</strong> — verified by the backend at every sign-in.</p>
  `;
  container.querySelector('#copy-codes')?.addEventListener('click', () => {
    const text = (recoveryCodes ?? []).join('\n');
    navigator.clipboard.writeText(text).then(() => {
      toasts.success('Copied', 'Recovery codes copied to clipboard.');
    }).catch(() => {
      toasts.error('Copy failed', 'Copy the codes manually.');
    });
  });
}

// ── Disable wiring ───────────────────────────────────────────────────────────
function wireDisable(body) {
  const form = body.querySelector('#disable-form');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const codeError = body.querySelector('#disable-code-error');
    const formError = body.querySelector('#disable-error');
    codeError.textContent = '';
    formError.textContent = '';
    const code = form.code.value.trim();
    if (!/^[0-9]{6}$/.test(code)) { codeError.textContent = 'Enter the 6-digit code.'; return; }

    const btn = body.querySelector('#disable-btn');
    btn.disabled = true;
    btn.classList.add('btn--loading');
    try {
      await api.disableAuthenticator(code);
      toasts.success('Authenticator disabled', 'Your account no longer requires authenticator codes.');
      router.go('/settings/security');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (err?.status === 401) return;
      if (err?.status === 400) codeError.textContent = msg;
      else formError.textContent = msg;
    } finally {
      btn.disabled = false;
      btn.classList.remove('btn--loading');
    }
  });
}