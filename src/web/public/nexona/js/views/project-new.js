/**
 * New Project view — describe an idea, choose a mode, and let the real
 * Blueprint-First pipeline run for this account. Mode controls the lifecycle
 * scope (design-only | design-plus-code | full-product).
 */
import { api } from '../api.js';
import { router } from '../router.js';
import { toasts } from '../ui/toast.js';

const MODES = [
  { value: 'full-product', label: 'Full Product', desc: 'Discovery → Design → Blueprint → Build → Test → Deployment → Operations → Continuous Engineering.' },
  { value: 'design-plus-code', label: 'Design + Code', desc: 'Discovery → Design → Blueprint → Build. Stops before deployment/operations.' },
  { value: 'design-only', label: 'Design Only', desc: 'Discovery → Design → Blueprint. Stops before implementation.' },
];

export function mount(params, account) {
  const content = document.querySelector('#app-content');
  if (!content) return;

  content.innerHTML = `
    <div class="page">
      <header class="page__header">
        <div>
          <h1 class="page__title">New Project</h1>
          <p class="page__subtitle">Describe what you want to build. NEXORA structures it into a governed engineering lifecycle.</p>
        </div>
      </header>

      <form class="form card form--wide" id="new-project-form">
        <div class="form-group">
          <label class="form-label" for="name">Project name</label>
          <input class="form-input" type="text" id="name" name="name" required
                 minlength="2" maxlength="64" placeholder="e.g. TeamTask">
          <div class="form-error" id="name-error"></div>
        </div>

        <div class="form-group">
          <label class="form-label" for="vision">Vision / idea</label>
          <textarea class="form-textarea" id="vision" name="vision" rows="5" required
                    minlength="10" placeholder="What are you building? Who is it for? What problem does it solve?"></textarea>
          <div class="form-hint">NEXORA reads this to drive discovery, design, and the blueprint.</div>
          <div class="form-error" id="vision-error"></div>
        </div>

        <div class="form-group">
          <label class="form-label" for="mode">Lifecycle mode</label>
          <div class="radio-group" id="mode-group">
            ${MODES.map((m) => `
              <label class="radio-option">
                <input type="radio" name="mode" value="${m.value}" ${m.value === 'full-product' ? 'checked' : ''}>
                <span class="radio-option__label">${m.label}</span>
                <span class="radio-option__desc">${m.desc}</span>
              </label>`).join('')}
          </div>
        </div>

        <div class="form-error form-error--banner" id="form-error"></div>

        <div class="form-actions">
          <button type="button" class="btn btn--secondary" id="cancel-btn">Cancel</button>
          <button type="submit" class="btn btn--primary" id="submit-btn">
            <span class="btn__text">Create Project</span>
            <span class="btn__spinner" aria-hidden="true"></span>
          </button>
        </div>
      </form>

      <section class="panel" id="run-progress" hidden>
        <h2 class="panel__title">Engineering run</h2>
        <div class="panel__body" id="run-progress-body">
          <p class="muted">Starting the Blueprint-First pipeline…</p>
        </div>
      </section>
    </div>
  `;

  document.getElementById('cancel-btn')?.addEventListener('click', () => router.go('/dashboard'));
  document.getElementById('new-project-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    ['name-error', 'vision-error', 'form-error'].forEach((id) => { document.getElementById(id).textContent = ''; });

    const name = form.name.value.trim();
    const vision = form.vision.value.trim();
    const mode = new FormData(form).get('mode') || 'full-product';

    let valid = true;
    if (name.length < 2) { document.getElementById('name-error').textContent = 'Name must be at least 2 characters.'; valid = false; }
    if (vision.length < 10) { document.getElementById('vision-error').textContent = 'Describe your idea in at least 10 characters.'; valid = false; }
    if (!valid) return;

    const submitBtn = document.getElementById('submit-btn');
    submitBtn.disabled = true;
    submitBtn.classList.add('btn--loading');
    document.getElementById('run-progress').hidden = false;

    try {
      const res = await api.createProject({ name, vision, mode });
      document.getElementById('run-progress-body').innerHTML = `
        <p class="ok">Project created: <strong>${esc(res.project?.id ?? '')}</strong> (${esc(mode)}). The Blueprint-First chain produced ${res.summary?.discoveryArtifacts ?? '…'} discovery artifacts.</p>`;
      toasts.success('Project created', (res.project?.title ?? 'Project') + ' is ready.');
      router.go(`/projects/${encodeURIComponent(res.project?.id ?? '')}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      document.getElementById('form-error').textContent = msg;
      document.getElementById('run-progress').hidden = true;
      toasts.error('Project creation failed', msg);
    } finally {
      submitBtn.disabled = false;
      submitBtn.classList.remove('btn--loading');
    }
  });

  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  document.body.classList.add('main-app');
  return () => {};
}