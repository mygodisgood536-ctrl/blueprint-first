/**
 * Nexona router — hash-based, with auth guards and lazy view loading.
 *
 * Public routes: /, /how, /difference, /login, /signup, /forgot, /reset
 * Protected routes: everything under /app/*
 *
 * The router is the single source of truth for "what screen is active."
 * Views are mounted onto #app by view modules.
 */

import { api, onUnauthorized } from './api.js';

const ROUTES = {
    // Public
  '/': { view: 'splash', public: true },
  '/intro': { view: 'intro', public: true },
  '/how': { view: 'how', public: true },
  '/difference': { view: 'difference', public: true },
  '/login': { view: 'login', public: true },
  '/signup': { view: 'signup', public: true },
  '/forgot': { view: 'forgot', public: true },
  '/reset': { view: 'forgot', public: true },
  // Protected
  '/dashboard': { view: 'dashboard', auth: true },
  '/projects': { view: 'projects', auth: true },
  '/projects/new': { view: 'project-new', auth: true },
  '/projects/:id': { view: 'project', auth: true },
  '/projects/:id/settings': { view: 'project-settings', auth: true },
  '/documents': { view: 'documents', auth: true },
  '/documents/upload': { view: 'documents-upload', auth: true },
  '/documents/:id': { view: 'document', auth: true },
  '/providers': { view: 'providers', auth: true },
  '/settings/profile': { view: 'settings-profile', auth: true },
  '/settings/security': { view: 'settings-security', auth: true },
  '/settings/security/password': { view: 'settings-security-password', auth: true },
  '/settings/security/authenticator': { view: 'settings-security-authenticator', auth: true },
  '/settings/security/sessions': { view: 'settings-security-sessions', auth: true },
  '/settings/security/events': { view: 'settings-security-events', auth: true },
  '/settings/preferences': { view: 'settings-preferences', auth: true },
    '/help': { view: 'help', public: true },
  '/404': { view: '404', public: true },
};

class Router {
  constructor() {
    this.currentView = null;
    this.account = null; // { id, displayName, role } from session
    this.init();
  }

  init() {
    window.addEventListener('hashchange', () => this.navigate());
    // Initial load — resolve session, then route
    this.bootstrap();
    // Listen for navigation events from views
    window.addEventListener('nexona:navigate', (e) => this.go(e.detail.to));
    window.addEventListener('nexona:logout', () => this.doLogout());
    // Handle 401 (session expired / not authenticated) — clear state, go to login
    onUnauthorized = () => {
      this.account = null;
      document.body.classList.remove('main-app');
      this.go('/login');
    };
  }

  async bootstrap() {
    try {
      const { account } = await api.session();
      this.account = account;
    } catch {
      this.account = null;
    }
    this.navigate();
  }

  parseHash() {
    let hash = window.location.hash || '#/';
    if (hash.startsWith('#')) hash = hash.slice(1);
    return hash;
  }

  match(pathname) {
    for (const [pattern, config] of Object.entries(ROUTES)) {
      const params = {};
      let match = true;
      const patternParts = pattern.split('/').filter(Boolean);
      const pathParts = pathname.split('/').filter(Boolean);
      if (patternParts.length !== pathParts.length) continue;
      for (let i = 0; i < patternParts.length; i++) {
        const p = patternParts[i];
        const s = pathParts[i];
        if (p === undefined || s === undefined) { match = false; break; }
        if (p.startsWith(':')) {
          params[p.slice(1)] = decodeURIComponent(s);
        } else if (p !== s) {
          match = false; break;
        }
      }
      if (match) return { config, params };
    }
    return { config: ROUTES['/404'], params: {} };
  }

  async navigate() {
    const hash = this.parseHash();
    const { config, params } = this.match(hash);

    // Auth guard
    if (config.auth && !this.account) {
      this.go('/login');
      return;
    }
    // Redirect authenticated users away from auth pages
    if ((config.view === 'login' || config.view === 'signup' || config.view === 'forgot') && this.account) {
      this.go('/dashboard');
      return;
    }

    await this.render(config.view, params, config);
  }

  async render(viewName, params, config) {
    // Lazy-load the view module
    let viewModule;
    try {
      viewModule = await import(`./views/${viewName}.js`);
    } catch {
      viewModule = await import('./views/404.js');
      viewName = '404';
    }
    if (this.currentView && this.currentView.unmount) {
      this.currentView.unmount();
    }
    this.currentView = {
      view: viewName,
      unmount: viewModule.mount(params, this.account),
    };
  }

  go(to) {
    window.location.hash = to;
  }

  async doLogout() {
    try {
      await api.logout();
    } catch {
      // ignore
    }
    this.account = null;
    this.go('/login');
  }
}

// Export a singleton
export const router = new Router();
