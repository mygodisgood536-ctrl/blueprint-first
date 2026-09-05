/**
 * Help / Customer Care view.
 *
 * Real contact information for the NEXORA founder.
 */
import { router } from '../router.js';

export function mount(params, account) {
  const content = document.querySelector('#app-content');
  if (!content) return;

  content.innerHTML = `
    <section class="carepage">
      <div class="container carepage__container">
        <div class="carepage__card">
          <div class="carepage__brand">
            <img src="/nexona/img/logo-icon.svg" alt="" class="carepage__logo" width="32" height="32" />
          </div>
          <h1 class="carepage__title">Customer Care</h1>
          <p class="carepage__subtitle">
            NEXORA is built by a real engineering team. Reach out directly.
          </p>

          <div class="carepage__contact">
            <div class="contact-card">
              <div class="contact-card__icon" aria-hidden="true">👤</div>
              <div class="contact-card__label">Founder</div>
              <div class="contact-card__value">Cornelius Adedeji Victor</div>
            </div>

            <div class="contact-card">
              <div class="contact-card__icon" aria-hidden="true">💬</div>
              <div class="contact-card__label">WhatsApp</div>
              <div class="contact-card__value">
                <a href="https://wa.me/2348154076947" target="_blank" rel="noopener noreferrer">
                  0815 407 6947
                </a>
              </div>
            </div>

            <div class="contact-card">
              <div class="contact-card__icon" aria-hidden="true">📞</div>
              <div class="contact-card__label">Phone</div>
              <div class="contact-card__value">
                <a href="tel:+2348154076947">0815 407 6947</a>
                <span class="contact-card__sep">·</span>
                <a href="tel:+2347061743252">0706 174 3252</a>
              </div>
            </div>

            <div class="contact-card">
              <div class="contact-card__icon" aria-hidden="true">✉️</div>
              <div class="contact-card__label">Email</div>
              <div class="contact-card__value">
                <a href="mailto:adedejicorneliusvictor@gmail.com">
                  adedejicorneliusvictor@gmail.com
                </a>
              </div>
            </div>
          </div>

          <div class="carepage__note">
            <p>
              This is a real contact endpoint. Please do not use it for automated
              requests or abuse. For account-specific support, sign in first so we
              can look up your account.
            </p>
          </div>

          ${account ? '' : `
          <div class="carepage__actions">
            <a href="#/signup" class="btn btn--primary">Create an account</a>
            <a href="#/login" class="btn btn--secondary">Log in</a>
          </div>
          `}
        </div>
      </div>
    </section>
  `;

  document.body.classList.remove('main-app');
  return () => {};
}
