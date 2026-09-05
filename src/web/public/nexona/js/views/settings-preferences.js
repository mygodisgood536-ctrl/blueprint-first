/**
 * Preferences view — manage this account's stored preferences.
 *
 * Backend contract (src/web/auth-api.ts):
 *   GET  /api/account/preferences   -> { preferences: { [key]: string|number|boolean } }
 *   POST /api/account/preferences   -> { preferences }  (patch merge; scalar values only)
 *
 * Values are real, durable, per-account backend state. The page shows exactly
 * what is stored and each change persists.
 */
import { api } from '../api.js';
import { router } from '../router.js';
import { toasts } from '../ui/toast.js';

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function valueInput(value) {
  if (typeof value === 'boolean') {
    return `<select class="form-input" name="val" data-type="boolean">
      <option value="true" ${value ? 'selected' : ''}>true</option>
      <option value="false" ${value ? '' : 'selected'}>false</option>
    </select>`;
  }
  if (typeof value === 'number') {
    return `<input class="form-input" type="number" name="val" data-type="number" value="${esc(String(value))}">`;
  }
  return `<input class="form-input" type="text" name="val" data-type="string" value="${esc(value)}">`;
}

export function mount(params, account) {
  const content = document.querySelector('#app-content');
  if (!content) return;
  if (!account) { router.go('/login'); return () => {}; }

  content.innerHTML = `
    <div class="page">
      <header class="page__header">
        <div>
          <h1 class="page__title">Preferences</h1>
          <p class="page__subtitle">Stored per-account settings used by NEXORA.</p>
        </div>
      </header>

      <section class="panel">
        <h2 class="panel__title">Stored preferences</h2>
        <div class="panel__body" id="prefs-body">
          <div class="skeleton skeleton--text" style="width:50%"></div>
          <div class="skeleton skeleton--text" style="width:30%"></div>
        </div>
      </section>

      <section class="panel">
        <h2 class="panel__title">Add / update a preference</h2>
        <div class="panel__body">
          <form class="form" id="pref-form" style="max-width:520px">
            <div class="form-group">
              <label class="form-label" for="pref-key">Key</label>
              <input class="form-input" type="text" id="pref-key" name="key" required
                     minlength="1" maxlength="41" pattern="[a-zA-Z][a-zA-Z0-9_-]{0,40}">
              <div class="form-hint">Begins with a letter; then letters, digits, hyphen, underscore.</div>
            </div>
            <div class="form-group">
              <label class="form-label" for="pref-value">Value</label>
              <div class="form-row">
                <select class="form-input" id="pref-type" name="type" style="width:140px">
                  <option value="string">string</option>
                  <option value="number">number</option>
                  <option value="boolean">boolean</option>
                </select>
                <input class="form-input" type="text" id="pref-value" name="val" placeholder="value">
              </div>
            </div>
            <div class="form-error form-error--banner" id="pref-error"></div>
            <button class="btn btn--primary" type="submit" id="pref-save">
              <span class="btn__text">Save preference</span>
              <span class="btn__spinner" aria-hidden="true"></span>
            </button>
          </form>
        </div>
      </section>
    </div>
  `;

  document.body.classList.add('main-app');
  loadPrefs().catch((err) => {
    if (err?.status === 401) return;
    const body = document.getElementById('prefs-body');
    if (body) {
      body.innerHTML = `
        <div class="error-state">
          <div class="error-state__icon">&#9888;&#65039;</div>
          <h3 class="error-state__title">Could not load preferences</h3>
          <p class="error-state__desc">${esc(err.message || 'Check your connection and try again.')}</p>
          <div class="error-state__action"><button class="btn btn--primary" id="prefs-retry">Retry</button></div>
        </div>`;
      document.getElementById('prefs-retry')?.addEventListener('click', () => router.go('/settings/preferences'));
    }
    void err;
  });
async function loadPrefs() {
  const body = document.getElementById('prefs-body');
  if (!body) return;
  const { preferences } = await api.getPreferences();
  const entries = Object.entries(preferences ?? {});
  if (entries.length === 0) {
    body.innerHTML = `
      <div class="empty-state">
        <div class="empty-state__icon">🗂️</div>
        <h3 class="empty-state__title">No preferences stored</h3>
        <p class="empty-state__desc">Add a preference below. Values are stored per-account on the server.</p>
      </div>`;
    return;
  }
  body.innerHTML = `<div class="pref-list">
    ${entries.map(([key, value]) => `
      <div class="pref-item" data-key="${esc(key)}">
        <div class="pref-item__key"><code>${esc(key)}</code></div>
        <div class="pref-item__value">${valueInput(value)}</div>
        <span class="pref-item__type">${typeof value}</span>
        <button class="btn btn--secondary btn--sm pref-item__save" type="button" data-key="${esc(key)}">Save</button>
      </div>`).join('')}
  </div>`;

  document.querySelectorAll('.pref-item__save').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.key;
      const item = Array.from(document.querySelectorAll('.pref-item')).find((el) => el.dataset.key === key);
      if (!item) return;
      const valEl = item.querySelector('[name="val"]');
      const type = valEl.dataset.type;
      const raw = valEl.value;
      let value = raw;
      if (type === 'number') value = Number(raw);
      if (type === 'boolean') value = raw === 'true';
      savePref(key, value, () => loadPrefs());
    });
  });
}

function wireForm(reload) {
  const form = document.getElementById('pref-form');
  const typeSel = document.getElementById('pref-type');
  const valueEl = document.getElementById('pref-value');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formError = document.getElementById('pref-error');
    formError.textContent = '';
    const key = form.key.value.trim();
    const type = typeSel.value;
    const raw = valueEl.value;
    if (!key) {
      formError.textContent = 'Enter a key.';
      return;
    }
    let value = raw;
    if (type === 'number') value = Number(raw);
    if (type === 'boolean') value = raw === 'true' || raw === 'false' ? raw === 'true' : raw;
    const btn = document.getElementById('pref-save');
    btn.disabled = true;
    btn.classList.add('btn--loading');
    try {
      await api.updatePreferences({ [key]: value });
      toasts.success('Preference saved', `"${key}" saved to your account.`);
      form.key.value = '';
      valueEl.value = '';
      reload();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (err?.status === 401) return;
      formError.textContent = msg;
    } finally {
      btn.disabled = false;
      btn.classList.remove('btn--loading');
    }
  });
}

async function savePref(key, value, reload) {
  try {
    await api.updatePreferences({ [key]: value });
    toasts.success('Preference saved', `"${key}" updated.`);
    reload();
  } catch (err) {
    if (err?.status === 401) return;
    toasts.error('Save failed', err instanceof Error ? err.message : String(err));
  }
}

  wireForm(() => loadPrefs());
  return () => {};
}