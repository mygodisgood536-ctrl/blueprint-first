/**
 * Splash view — a brief (~4 s) professional NEXORA brand reveal.
 *
 * Behaviour:
 *   - Authenticated users skip the splash and are sent to /dashboard.
 *   - Anonymous users see the NEXORA logo with a restrained entrance animation.
 *   - Auto-advances to #/intro after ~4 s (800 ms if prefers-reduced-motion).
 *   - Any click/tap or the "Skip" button advances immediately ("do not trap").
 *   - Independent of backend availability (no API calls needed).
 */
export function mount(params, account) {
  const content = document.querySelector('#app-content');
  if (!content) return;

  // Authenticated users never see the splash — go straight to dashboard.
  if (account) {
    window.location.hash = '#/dashboard';
    return () => {};
  }

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const SPLASH_MS = reduced ? 800 : 4000;

  content.innerHTML = `
    <section class="splash" role="status" aria-live="polite">
      <div class="splash__inner">
        <img src="/nexona/img/logo.svg"
             alt="NEXORA — The Blueprint AI Software Engineering Platform"
             class="splash__logo"
             loading="eager" />
        <button class="splash__skip btn btn--secondary btn--sm" id="splash-skip" type="button">
          Skip
        </button>
      </div>
    </section>
  `;

  // Public pages use full-bleed layout (no shell chrome).
  document.body.classList.remove('main-app');

  let done = false;
  const advance = () => {
    if (done) return;
    done = true;
    content.classList.add('splash--exit');
    // Fade out then navigate.
    setTimeout(() => {
      window.location.hash = '#/intro';
    }, 400);
  };

  // Skip button
  const skip = document.getElementById('splash-skip');
  if (skip) skip.addEventListener('click', advance);
  // Any click/tap advances immediately.
  content.addEventListener('click', advance);

  // Auto-advance.
  setTimeout(advance, SPLASH_MS);

  // Entrance animation class (only when motion is not reduced).
  if (!reduced) {
    requestAnimationFrame(() => {
      content.classList.add('splash--animate');
    });
  }

  return () => {};
}