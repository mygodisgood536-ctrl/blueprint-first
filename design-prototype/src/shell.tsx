/**
 * Application shell: header, navigation, account menu and mobile navigation.
 *
 * Every control here does something real. Search queries the caller's own
 * artifacts and projects over the API and navigates to the results — a stub
 * that only pushed a toast is exactly the dead control the vision forbids.
 */
import React, { useEffect, useRef, useState } from 'react'
import { useStore } from './store'
import { navigate } from './router'
import { I, IconName } from './icons2'
import { api } from './api'

interface NavItem { icon: IconName; label: string; route: string }

const primaryNav: NavItem[] = [
  { icon: 'home', label: 'Dashboard', route: '#/dashboard' },
  { icon: 'folder', label: 'Projects', route: '#/projects' },
  { icon: 'fileText', label: 'Documents', route: '#/documents' },
  { icon: 'activity', label: 'Execution', route: '#/execution' },
]

const engineeringNav: NavItem[] = [
  { icon: 'box', label: 'Artifacts', route: '#/artifacts' },
  { icon: 'link', label: 'Evidence', route: '#/evidence' },
  { icon: 'gitBranch', label: 'Lineage', route: '#/lineage' },
  { icon: 'grid', label: 'Dependency map', route: '#/dependency-map' },
  { icon: 'repeat', label: 'Traceability', route: '#/traceability' },
  { icon: 'checkCircle', label: 'Verification', route: '#/verification' },
  { icon: 'award', label: 'Certification', route: '#/certification' },
  { icon: 'flask', label: 'Testing', route: '#/testing' },
  { icon: 'key', label: 'Providers', route: '#/providers' },
  { icon: 'activity', label: 'Operations', route: '#/operations' },
  { icon: 'refresh', label: 'Continuous', route: '#/continuous' },
  { icon: 'database', label: 'System', route: '#/system' },
]

const secondaryNav: NavItem[] = [
  { icon: 'info', label: 'About', route: '#/about' },
  { icon: 'settings', label: 'Preferences', route: '#/settings/preferences' },
  { icon: 'help', label: 'Help', route: '#/help' },
]

interface SearchHit { id: string; label: string; kind: string; route: string }

export function Shell({
  children,
  breadcrumb,
}: {
  children: React.ReactNode
  breadcrumb?: { label: string; route?: string }[]
}) {
  const { auth, logout, pushToast } = useStore()
  const [menuOpen, setMenuOpen] = useState(false)
  const [searchQ, setSearchQ] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [searching, setSearching] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const searchRef = useRef<HTMLDivElement | null>(null)
  const hash = window.location.hash || '#/dashboard'
  const isOwner = auth.canManagePlatform

  const isActive = (route: string) => hash === route || hash.startsWith(route + '/')

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setSearchOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [])

  /* Real search: queries the caller's own artifacts and projects. */
  useEffect(() => {
    const q = searchQ.trim()
    if (q.length < 2) {
      setHits([])
      return
    }
    let alive = true
    setSearching(true)
    const timer = window.setTimeout(() => {
      Promise.all([api.artifacts.list(), api.projects.list()])
        .then(([artifacts, projects]) => {
          if (!alive) return
          const needle = q.toLowerCase()
          const artifactHits: SearchHit[] = artifacts.artifacts
            .filter((a) => `${a.id} ${a.title}`.toLowerCase().includes(needle))
            .slice(0, 8)
            .map((a) => ({ id: a.id, label: a.title || a.id, kind: a.type, route: `#/artifacts/${a.id}` }))
          const projectHits: SearchHit[] = projects.projects
            .filter((p) => p.title.toLowerCase().includes(needle))
            .slice(0, 5)
            .map((p) => ({ id: p.id, label: p.title, kind: 'Project', route: `#/projects/${p.id}` }))
          setHits([...projectHits, ...artifactHits])
          setSearchOpen(true)
        })
        .catch((err: unknown) => {
          if (!alive) return
          pushToast(err instanceof Error ? err.message : 'Search could not be completed.', 'error')
        })
        .finally(() => {
          if (alive) setSearching(false)
        })
    }, 220)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [searchQ, pushToast])

  const goToHit = (hit: SearchHit) => {
    setSearchQ('')
    setHits([])
    setSearchOpen(false)
    navigate(hit.route)
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>

      <header className="topbar">
        <div className="container-page topbar-inner">
          <a className="logo" href="#/dashboard" aria-label="NEXORA dashboard">
            <span className="logo-mark" aria-hidden="true">
              NX
            </span>
            <span className="brand-text">
              <span className="brand-name">NEXORA</span>
              <span className="brand-sub">Blueprint First AI Engineering</span>
            </span>
          </a>

          <div className="topbar-search" ref={searchRef} style={{ position: 'relative' }}>
            <div className="search-wrap">
              <span className="search-icon">
                <I name="search" size={15} />
              </span>
              <input
                className="search-input"
                type="search"
                placeholder="Search projects and artifacts"
                aria-label="Search projects and artifacts"
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                onFocus={() => hits.length > 0 && setSearchOpen(true)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setSearchQ('')
                    setSearchOpen(false)
                  }
                  if (e.key === 'Enter' && hits.length > 0) goToHit(hits[0]!)
                }}
              />
            </div>
            {searchOpen && hits.length > 0 && (
              <div className="account-menu" style={{ left: 0, right: 0, minWidth: 0, top: 'calc(100% + 0.5rem)' }}>
                {hits.map((hit) => (
                  <button key={`${hit.kind}:${hit.id}`} onClick={() => goToHit(hit)}>
                    <span className="mono-tag">{hit.kind}</span>
                    <span className="truncate">{hit.label}</span>
                  </button>
                ))}
              </div>
            )}
            {searching && <span className="sr-only">Searching</span>}
          </div>

          <div className="grow" />

          <div className="account-dropdown">
            <button
              className="account-menu-btn"
              onClick={() => setMenuOpen((v) => !v)}
              aria-expanded={menuOpen}
              aria-haspopup="menu"
            >
              <span className="avatar" aria-hidden="true">
                {auth.fullName?.[0]?.toUpperCase() || 'U'}
              </span>
              <span className="text-sm nowrap">{auth.fullName}</span>
              <I name="chevronDown" size={16} />
            </button>
            {menuOpen && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 50 }} onClick={() => setMenuOpen(false)} />
                <div className="account-menu" role="menu">
                  <div className="dd-header">
                    <div className="dd-name">{auth.fullName}</div>
                    <div className="dd-email">@{auth.username}</div>
                  </div>
                  <a href="#/settings/profile" role="menuitem" onClick={() => setMenuOpen(false)}>
                    <I name="user" /> Profile
                  </a>
                  <a href="#/settings/preferences" role="menuitem" onClick={() => setMenuOpen(false)}>
                    <I name="settings" /> Preferences
                  </a>
                  <div className="dd-divider" />
                  <a href="#/help" role="menuitem" onClick={() => setMenuOpen(false)}>
                    <I name="help" /> Help
                  </a>
                  <button role="menuitem" onClick={() => { setMenuOpen(false); logout() }}>
                    <I name="logout" /> Log out
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <div className="app-shell-body">
        <aside className="sidebar">
          <nav className="sidebar-nav" aria-label="Primary">
            <div className="sidebar-section">Workspace</div>
            {primaryNav.map((n) => (
              <a
                key={n.route}
                href={n.route}
                className={`nav-item ${isActive(n.route) ? 'current active' : ''}`}
                aria-current={isActive(n.route) ? 'page' : undefined}
              >
                <span className="nav-icon">
                  <I name={n.icon} />
                </span>
                <span className="nav-label">{n.label}</span>
              </a>
            ))}
            <div className="sidebar-section">Engineering record</div>
            {engineeringNav.map((n) => (
              <a
                key={n.route}
                href={n.route}
                className={`nav-item ${isActive(n.route) ? 'current active' : ''}`}
                aria-current={isActive(n.route) ? 'page' : undefined}
              >
                <span className="nav-icon">
                  <I name={n.icon} />
                </span>
                <span className="nav-label">{n.label}</span>
              </a>
            ))}
            <div className="sidebar-section">Account</div>
            {secondaryNav.map((n) => (
              <a
                key={n.route}
                href={n.route}
                className={`nav-item ${isActive(n.route) ? 'current active' : ''}`}
                aria-current={isActive(n.route) ? 'page' : undefined}
              >
                <span className="nav-icon">
                  <I name={n.icon} />
                </span>
                <span className="nav-label">{n.label}</span>
              </a>
            ))}

            {/* Platform configuration. Not rendered for accounts without the
                administrative role; the backend independently refuses the
                owner-only routes, so this is presentation, not the boundary. */}
            {isOwner && (
              <>
                <div className="sidebar-section">Administration</div>
                <a
                  href="#/settings/infrastructure"
                  className={`nav-item ${isActive('#/settings/infrastructure') ? 'current active' : ''}`}
                  aria-current={isActive('#/settings/infrastructure') ? 'page' : undefined}
                >
                  <span className="nav-icon">
                    <I name="settings" />
                  </span>
                  <span className="nav-label">Infrastructure</span>
                </a>
              </>
            )}
          </nav>
          <div className="sidebar-footer">
            <p className="mono-label">Nothing advances without evidence</p>
          </div>
        </aside>

        <div className="main-area">
          {breadcrumb && breadcrumb.length > 0 && (
            <div className="content" style={{ paddingBottom: 0, paddingTop: '1rem' }}>
              <nav className="breadcrumb" aria-label="Breadcrumb">
                <a href="#/dashboard">Home</a>
                {breadcrumb.map((b, i) => (
                  <React.Fragment key={i}>
                    <span aria-hidden="true">/</span>
                    {b.route && i < breadcrumb.length - 1 ? (
                      <a href={b.route}>{b.label}</a>
                    ) : (
                      <span className="current">{b.label}</span>
                    )}
                  </React.Fragment>
                ))}
              </nav>
            </div>
          )}
          <main className="content" id="main-content">
            {children}
          </main>

          <nav className="bottom-nav" aria-label="Primary mobile">
            {primaryNav.slice(0, 4).map((n) => (
              <a
                key={n.route}
                href={n.route}
                className={`bn-item ${isActive(n.route) ? 'current active' : ''}`}
                aria-current={isActive(n.route) ? 'page' : undefined}
              >
                <I name={n.icon} />
                <span>{n.label}</span>
              </a>
            ))}
            <a href="#/settings/profile" className={`bn-item ${hash.startsWith('#/settings') ? 'current active' : ''}`}>
              <I name="user" />
              <span>Account</span>
            </a>
          </nav>
        </div>
      </div>
    </div>
  )
}