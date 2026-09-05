/**
 * Nexona app entry point.
 *
 * Builds the application shell (top bar + sidebar + main content), wires the
 * account menu and sidebar navigation, then starts the router. The router
 * lazy-loads views and mounts them into #app-content.
 *
 * Layout modes:
 *   - Public pages (/, /login, /signup, ...): full-bleed, no shell chrome.
 *   - App pages (dashboard, projects, ...): shell visible with sidebar.
 * The mode is toggled by the presence of the `main-app` class on <body>,
 * which each view sets/unsets in its mount().
 */

import { api } from './api.js';
import { router } from './router.js';

const SIDEBAR_LINKS = [
  { href: '#/dashboard', label: 'Dashboard', icon: '◧' },
  { href: '#/projects', label: 'Projects', icon: '⧉' },
  { href: '#/providers', label: 'Providers', icon: '⚙' },
  { href: '#/settings/profile', label: 'Settings', icon: '⚿' },
  { href: '#/help', label: 'Help', icon: '?' },
];

function buildShell() {
  const app = document.getElementById('app');
  if (!app) return null;

  app.innerHTML = `
    <header class="top-bar">
            <a href="#/" class="top-bar__brand"><img src="/nexona/img/logo-icon.svg" alt="" class="top-bar__logo" width="28" height="28" />NEXORA</a>
      <div class="top-bar__search">
        <input type="search" class="top-bar__search-input" placeholder="Search projects..." aria-label="Search" />
      </div>
      <div class="top-bar__actions">
        <div class="top-bar__user" id="user-menu">
          <span class="top-bar__user-name" id="user-name"></span>
          <button class="btn btn--primary btn--sm" id="account-btn" aria-haspopup="true">
            Account
          </button>
          <div class="account-dropdown" id="account-dropdown" hidden>
            <a href="#/settings/profile" class="account-dropdown__item">Profile</a>
            <a href="#/settings/security" class="account-dropdown__item">Security</a>
            <a href="#/settings/preferences" class="account-dropdown__item">Preferences</a>
            <a href="#/help" class="account-dropdown__item">Help</a>
            <hr class="account-dropdown__divider" />
            <button class="account-dropdown__item" id="logout-btn">Log out</button>
          </div>
        </div>
      </div>
    </header>

    <div class="body">
      <aside class="sidebar">
        <nav class="sidebar__nav" id="sidebar-nav">
          ${SIDEBAR_LINKS.map(
            (link) => `
            <a href="${link.href}" class="sidebar__link" data-route="${link.href}">
              <span class="sidebar__icon">${link.icon}</span>
              <span>${link.label}</span>
            </a>
          `,
          ).join('')}
        </nav>
      </aside>

      <main class="content" id="app-content"></main>
    </div>
  `;

  return app;
}

function wireAccountMenu() {
  const accountBtn = document.getElementById('account-btn');
  const dropdown = document.getElementById('account-dropdown');
  const logoutBtn = document.getElementById('logout-btn');

  if (accountBtn && dropdown) {
    accountBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.hidden = !dropdown.hidden;
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#user-menu')) {
        dropdown.hidden = true;
      }
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('nexona:logout'));
    });
  }
}

function updateUserDisplay(account) {
  const nameEl = document.getElementById('user-name');
  if (nameEl) {
    nameEl.textContent = account ? account.displayName || account.username : '';
  }
  // Show/hide shell chrome based on auth
  if (account) {
    document.body.classList.add('main-app');
  } else {
    document.body.classList.remove('main-app');
  }
}

function highlightActiveRoute() {
  const hash = window.location.hash || '#/';
  document.querySelectorAll('.sidebar__link').forEach((link) => {
    const route = link.getAttribute('data-route');
    if (route && (hash === route || hash.startsWith(route + '/') || hash.startsWith(route + '?'))) {
      link.classList.add('sidebar__link--active');
    } else {
      link.classList.remove('sidebar__link--active');
    }
  });
}

async function main() {
  buildShell();
  wireAccountMenu();

  // Keep user display + chrome in sync with router state
  const syncAccount = () => updateUserDisplay(router.account);
  window.addEventListener('hashchange', syncAccount);
  window.addEventListener('nexona:account-changed', syncAccount);
  syncAccount();

  // Highlight the active sidebar link on navigation
  window.addEventListener('hashchange', highlightActiveRoute);
  highlightActiveRoute();

  // Start the router (lazy-loads the matching view)
  // The router is already auto-initialized on import; this ensures the
  // shell is built before the first view mounts.
  router.navigate();
}

main().catch((err) => {
  console.error('Nexona failed to start:', err);
});
