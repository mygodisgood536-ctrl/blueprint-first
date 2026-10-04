import React from 'react'
import { useHashRoute, parseRoute, Redirect } from './router'
import { resolveRoute } from './routes'
import { StoreProvider, useStore } from './store'
import { ToastHost } from './ui'
import { Splash, Welcome } from './pages/Welcome'
import { SignIn } from './pages/SignIn'
import { HowPage, DifferencePage } from './pages/Public'
import { HelpPage, FaqPage, HelpArticle, NotFound, Founder } from './pages/Help'
import { UseCasesPage } from './pages/UseCases'
import { Dashboard } from './pages/Dashboard'
import { ProjectsList } from './pages/Projects'
import { CreateProject } from './pages/CreateProject'
import { ProjectWorkspace } from './pages/ProjectWorkspace'
import { ProjectSettings } from './pages/ProjectSettings'
import { DocumentsList, DocumentDetail } from './pages/Documents'
import { ArtifactsList, ArtifactDetail } from './pages/Artifacts'
import { EvidenceList, EvidenceDetail } from './pages/Evidence'
import { Lineage } from './pages/Lineage'
import { DependencyMap } from './pages/DependencyMap'
import { Traceability } from './pages/Traceability'
import { Expansion } from './pages/Expansion'
import { Twin } from './pages/Twin'
import { SystemFoundation } from './pages/SystemFoundation'
import { OwnerSettings } from './pages/OwnerSettings'
import { Execution } from './pages/Execution'
import { Verification } from './pages/Verification'
import { Testing, Operations, Continuous, Certification } from './pages/Engineering'
import {
  Profile,
  Preferences,
} from './pages/Account'

function Router() {
  const hash = useHashRoute()
  const { auth } = useStore()
  const { path, parts } = parseRoute(hash)

  // Routing decisions come from a single, testable table (src/routes.ts) so the
  // entry model can be verified rather than only inspected by eye. Retired
  // routes resolve to a redirect, so a stale role-labelled URL can never become
  // a second public entry point. `canManagePlatform` is advisory presentation
  // only - the server enforces authorization on every privileged route.
  const decision = resolveRoute(hash, {
    authenticated: auth.authenticated,
    isAdministrator: auth.canManagePlatform,
  })
  if (decision.redirect !== undefined) return <Redirect to={decision.redirect} />

  switch (decision.kind) {
    case 'splash':
      return <Splash />
    case 'welcome':
      return <Welcome />
    case 'signin':
      return <SignIn />
    case 'ownerSettings':
      return <OwnerSettings isOwner />
    case 'notFound':
      return <NotFound />
    default:
      break
  }

  // Product routes, all of which require an authenticated account.
  if (path === '/dashboard') return <Dashboard />
  if (path === '/projects') return <ProjectsList />
  if (path === '/projects/new') return <CreateProject />
  if (parts[0] === 'projects' && parts[1] && parts[2] === 'settings') return <ProjectSettings id={parts[1]} />
  if (parts[0] === 'projects' && parts[1]) return <ProjectWorkspace id={parts[1]} />
  if (path === '/documents') return <DocumentsList />
  if (parts[0] === 'documents' && parts[1]) return <DocumentDetail id={parts[1]} />
  if (path === '/artifacts') return <ArtifactsList />
  if (parts[0] === 'artifacts' && parts[1]) return <ArtifactDetail id={parts[1]} />
  if (path === '/evidence') return <EvidenceList />
  if (parts[0] === 'evidence' && parts[1]) return <EvidenceDetail id={parts[1]} />
  if (path === '/lineage') return <Lineage />
  if (path === '/dependency-map') return <DependencyMap />
  if (path === '/traceability') return <Traceability />
  if (path === '/expansion') return <Expansion />
  if (path === '/twin') return <Twin />
  if (path === '/system') return <SystemFoundation />
  if (path === '/execution') return <Execution />
  if (parts[0] === 'projects' && parts[1] === 'execution') return <Execution projectId={parts[1]} />
  if (path === '/verification') return <Verification />
  if (path === '/testing') return <Testing />
  if (path === '/operations') return <Operations />
  if (path === '/continuous') return <Continuous />
  if (path === '/certification') return <Certification />
  if (path === '/settings/profile') return <Profile />
  if (path === '/settings/preferences') return <Preferences />
  if (path === '/founder' || path === '/about') return <Founder />
  if (path === '/help') return <HelpPage />
  if (path === '/faq') return <FaqPage />
  if (parts[0] === 'help' && parts[1] === 'article' && parts[2]) return <HelpArticle slug={parts[2]} />

  return <NotFound />
}

export function App() {
  return (
    <StoreProvider>
      <Router />
      <ToastHost />
    </StoreProvider>
  )
}
