/**
 * Not found view — 404 page.
 */
import { router } from '../router.js';

export function mount(params, account) {
  const content = document.querySelector('#app-content');
  if (!content) return;

  content.innerHTML = `
    <section class="auth-page">
      <div class="container auth-page__container" style="text-align: center;">
        <h1 class="not-found__title">404</h1>
        <p class="not-found__subtitle">Page not found</p>
        <p class="not-found__desc">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <button class="btn btn--primary" id="go-home">
          Go to Home
        </button>
      </div>
    </section>
  `;

  document.getElementById('go-home').addEventListener('click', () => router.go('/'));
  document.body.classList.remove('main-app');
  return () => {};
}
