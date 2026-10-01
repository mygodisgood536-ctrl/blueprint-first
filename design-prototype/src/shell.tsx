import React, { useState } from 'react'
import { useStore } from './store'
import { navigate } from './router'
import { I, IconName } from './icons2'

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
  { icon: 'activity', label: 'Operations', route: '#/operations' },
  { icon: 'refresh', label: 'Continuous', route: '#/continuous' },
  { icon: 'database', label: 'System', route: '#/system' },
]

const secondaryNav: NavItem[] = [
  { icon: 'info', label: 'About', route: '#/about' },
  { icon: 'shield', label: 'Security', route: '#/settings/security' },
  { icon: 'settings', label: 'Preferences', route: '#/settings/preferences' },
  { icon: 'help', label: 'Help', route: '#/help' },
]

export function Shell({ children, breadcrumb }: { children: React.ReactNode; breadcrumb?: { label: string; route?: string }[] }) {
  const { auth, logout, sidebarCollapsed, toggleSidebar, pushToast } = useStore()
  const [menuOpen, setMenuOpen] = useState(false)
  const [searchQ, setSearchQ] = useState('')
  const hash = window.location.hash || '#/dashboard'
  const isOwner = auth.role === 'admin'

  const isActive = (route: string) => hash === route || hash.startsWith(route + '/')

  const handleLogoClick = () => {
    navigate('#/dashboard')
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
        <div className="sidebar-brand" onClick={handleLogoClick} style={{ cursor: 'pointer' }}>
          <img className="logo" src="/favicon.svg" alt="" />
          <div><div className="brand-name">NEXORA</div><div className="brand-sub">Blueprint AI Platform</div></div>
        </div>
        <nav className="sidebar-nav">
          <div className="sidebar-section">Workspace</div>
          {primaryNav.map(n => (
            <a key={n.route} href={n.route} className={`nav-item ${isActive(n.route) ? 'active' : ''}`}>
              <I name={n.icon} /><span className="nav-label">{n.label}</span>
            </a>
          ))}
          <div className="sidebar-section">Engineering record</div>
          {engineeringNav.map(n => (
            <a key={n.route} href={n.route} className={`nav-item ${isActive(n.route) ? 'active' : ''}`}>
              <I name={n.icon} /><span className="nav-label">{n.label}</span>
            </a>
          ))}
          <div className="sidebar-section">Account</div>
          {secondaryNav.map(n => (
            <a key={n.route} href={n.route} className={`nav-item ${isActive(n.route) ? 'active' : ''}`}>
              <I name={n.icon} /><span className="nav-label">{n.label}</span>
            </a>
          ))}
          {/* Platform configuration. Not rendered for accounts without the
              administrative role; the backend independently refuses the
              /api/owner routes, so this is presentation, not the boundary. */}
          {isOwner && (
            <>
              <div className="sidebar-section">Administration</div>
              <a href="#/owner/settings" className={`nav-item ${isActive('#/owner/settings') ? 'active' : ''}`}>
                <I name="settings" /><span className="nav-label">Infrastructure</span>
              </a>
            </>
          )}
        </nav>
        <div className="sidebar-footer">
          <button className="btn btn-ghost btn-block btn-sm" onClick={toggleSidebar}>
            <I name="menu" /><span className="nav-label">{sidebarCollapsed ? 'Expand' : 'Collapse'}</span>
          </button>
        </div>
      </aside>

      <div className="main-area">
        <header className="topbar">
          <div className="topbar-search">
  <input
    placeholder="Search coming soon — Enter opens Help center"
    value={searchQ}
    onChange={e => setSearchQ(e.target.value)}
    onKeyDown={e => {
      if (e.key === 'Enter' && searchQ.trim()) {
        pushToast('Cross-project search is not implemented yet — Help center has index-based search.', 'info')
        setSearchQ('')
        navigate('#/help')
      }
    }}
  />
</div>
          {breadcrumb && (
            <div className="breadcrumb">
              <a href="#/dashboard">Home</a>
              {breadcrumb.map((b, i) => (
                <React.Fragment key={i}>
                  <span className="sep">/</span>
                  {b.route && i < breadcrumb.length - 1 ? <a href={b.route}>{b.label}</a> : <span className="current">{b.label}</span>}
                </React.Fragment>
              ))}
            </div>
          )}
          <div className="grow" />
          <div className="account-menu">
            <button className="account-menu-btn" onClick={() => setMenuOpen(!menuOpen)}>
              <div className="avatar">{auth.displayName?.[0]?.toUpperCase() || 'U'}</div>
              <span className="text-sm" style={{ fontWeight: 600 }}>{auth.displayName}</span>
              <I name="chevronDown" size={16} />
            </button>
            {menuOpen && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 99 }} onClick={() => setMenuOpen(false)} />
                <div className="account-dropdown">
                                <div className="dd-header"><div className="dd-name">{auth.displayName}</div><div className="dd-email">@{auth.username}</div></div>
                  <a href="#/settings/profile" className="dd-item" onClick={() => setMenuOpen(false)}><I name="user" />Profile</a>
                  <a href="#/settings/security" className="dd-item" onClick={() => setMenuOpen(false)}><I name="shield" />Security</a>
                  <a href="#/settings/preferences" className="dd-item" onClick={() => setMenuOpen(false)}><I name="settings" />Preferences</a>
                  <div className="dd-divider" />
                  <a href="#/help" className="dd-item" onClick={() => setMenuOpen(false)}><I name="help" />Help</a>
                  <button className="dd-item danger btn-block" style={{ justifyContent: 'flex-start' }} onClick={() => { setMenuOpen(false); logout() }}><I name="logout" />Log out</button>
                </div>
              </>
            )}
          </div>
        </header>

        <main className="content">{children}</main>

        <nav className="bottom-nav">
          {primaryNav.slice(0, 4).map(n => (
            <a key={n.route} href={n.route} className={`bn-item ${isActive(n.route) ? 'active' : ''}`}>
              <I name={n.icon} /><span>{n.label}</span>
            </a>
          ))}
                    <a href="#/settings/profile" className={`bn-item ${hash.startsWith('#/settings') ? 'active' : ''}`}>
            <I name="user" /><span>Account</span>
          </a>
        </nav>
      </div>
    </div>
  )
}
