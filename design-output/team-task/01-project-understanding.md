# TeamTask — Project Understanding (Blueprint-First Discovery)

## Purpose & Problem

**Product:** TeamTask — A lightweight task tracker for small teams (2–10 people)

**Problem:** Small teams need simple, visual task management without the overhead of Jira, Asana, or Monday.com. Existing tools are either too complex (enterprise features, permissions matrices, custom fields) or too simple (no project grouping, no workflow visualization).

**Core Value:** "Trello simplicity with project structure" — Kanban boards grouped by project, drag-and-drop task flow, minimal configuration, instant onboarding.

---

## Users & Actors

| Actor | Description | Core Needs |
|-------|-------------|------------|
| **Team Member** | Contributes to tasks, moves own tasks through workflow | Quick task creation, clear ownership, visible due dates, simple status changes |
| **Project Lead / Admin** | Creates projects, manages members, oversees progress | Project creation, member invitation, board overview, workload visibility |
| **Viewer (Stakeholder)** | Read-only access to project/board status | Clean read-only view, no edit affordances |

**Permission Model:**
- **Admin:** Create/delete projects, invite/remove members, delete any task, manage project settings
- **Member:** Create/edit/move own tasks, assign tasks to self/others, comment, complete tasks
- **Viewer:** Read-only access to boards and task details

---

## Features & Capabilities (Derived from Actual Need)

### Core (Must Have)
1. **Project Management** — Create/archive projects, project-level settings (name, description, members)
2. **Kanban Board** — Columns: Backlog → To Do → In Progress → In Review → Done (customizable per project)
3. **Task CRUD** — Create, read, update, delete tasks with title, description, due date, assignee, points
4. **Drag & Drop** — Move tasks between columns, reorder within column
5. **Task Assignment** — Assign to project members, unassign, self-assign
6. **Due Dates** — Set/clear due dates, overdue highlighting, due soon indicators
5. **Task Points** — Optional story points (1, 2, 3, 5, 8) for lightweight estimation
6. **Comments** — Threaded comments on tasks for collaboration
7. **Empty States** — Guided onboarding for new projects/boards
8. **Loading States** — Skeleton boards, optimistic UI for drag/drop
9. **Error States** — Network failure recovery, conflict resolution
10. **Responsive** — Mobile (stacked columns), tablet (2-col), desktop (full board)
11. **Accessibility** — Full keyboard navigation, screen reader support, focus management

### Admin / Management (Genuinely Required)
12. **Project Settings** — Rename, change column configuration, archive/restore
13. **Member Management** — Invite by email, change roles, remove members
14. **Task Bulk Actions** — Multi-select → move, assign, delete (admin only for delete)
15. **Board Filters** — Filter by assignee, due date, points, text search
16. **Activity Log** — Per-task history (moves, assignments, comments, edits)

### Not Included (Intentionally Out of Scope)
- Custom fields, workflows, automation rules
- Time tracking, burndown charts, velocity reports
- Integrations (GitHub, Slack, etc.)
- Subtasks, checklists, dependencies
- Epics, milestones, releases
- Dark mode (single light theme per project identity)

---

## Workflows & Journeys

### Primary: Task Lifecycle
```
Create Task → Assign → Move: To Do → In Progress → In Review → Done
                    ↓                    ↓              ↓
              (unassign)           (request review)  (reopen if needed)
```

### Secondary Workflows
- **Project Onboarding:** Create project → Invite members → Set columns → Create first tasks
- **Member Onboarding:** Accept invite → See projects → Open board → Create first task
- **Daily Standup:** Open board → Filter by assignee → Review In Progress/In Review
- **Sprint Planning:** Filter Backlog → Assign points → Move to To Do
- **Retrospective:** Filter Done (last sprint) → Review completed work

---

## Entities & Data Model

| Entity | Fields | Relationships |
|--------|--------|---------------|
| **Project** | id, name, description, columnConfig, createdAt, archivedAt | has many Members, has many Columns, has many Tasks |
| **Member** | id, projectId, userId, role (admin/member/viewer), joinedAt | belongs to Project, belongs to User |
| **Column** | id, projectId, name, order, wipLimit (optional) | belongs to Project, has many Tasks |
| **Task** | id, projectId, columnId, title, description, assigneeId, dueDate, points, order, createdAt, updatedAt, completedAt | belongs to Project, Column, Member (assignee), has many Comments |
| **Comment** | id, taskId, authorId, content, createdAt | belongs to Task, Member (author) |
| **Activity** | id, taskId, actorId, action, metadata, createdAt | belongs to Task, Member (actor) |

---

## Pages & Screens (Complete Inventory)

| Page | Route | Purpose | Primary Actor |
|------|-------|---------|---------------|
| **Project List / Dashboard** | `/` | Overview of all projects, create new | All |
| **Project Settings** | `/projects/:id/settings` | Configure project, members, columns | Admin |
| **Kanban Board** | `/projects/:id/board` | Primary task management view | Member, Admin |
| **Task Detail Modal** | `/projects/:id/tasks/:taskId` (modal) | View/edit task details, comments, history | All |
| **Task Create Modal** | `/projects/:id/tasks/new` (modal) | Create new task | Member, Admin |
| **Member Invite Flow** | `/projects/:id/invite` (modal) | Invite new members | Admin |
| **Mobile Board** | `/projects/:id/board?mobile=1` | Stacked column view | All |
| **Empty Project** | `/projects/:id/board` (no tasks) | Onboarding + first task CTA | All |
| **Error/Offline** | Any | Graceful degradation | All |

---

## Actions & Interactions (Complete)

### Board-Level
- Create task (FAB / column header +)
- Drag task between columns
- Reorder task within column
- Filter tasks (assignee, due, points, text)
- Toggle compact/comfortable density
- Open project settings (admin)

### Task-Level (on card)
- Click → Open detail modal
- Quick-assign (avatar drop zone)
- Due date indicator (color-coded)
- Points badge
- Drag handle (grip)

### Task Detail Modal
- Edit title, description
- Change assignee (dropdown)
- Set/clear due date (datepicker)
- Set/clear points (dropdown)
- Move to column (dropdown)
- Add comment (textarea + submit)
- View activity log (read-only)
- Delete task (admin only, with confirmation)
- Close (Esc, backdrop click, close button)

### Project Settings
- Edit project name/description
- Add/remove/reorder columns
- Set WIP limits per column
- Manage members (invite, role change, remove)
- Archive/restore project
- Danger zone: delete project (with confirmation)

---

## States & Outcomes (Per Component)

### Task Card
| State | Visual | Interaction |
|-------|--------|-------------|
| Default | Subtle shadow, white surface | Click → detail, Drag → move |
| Hover | Elevated shadow, subtle scale | Shows drag handle, quick actions |
| Focus | 2px focus ring (project primary) | Keyboard: Enter → detail, Arrows → move |
| Dragging | Opacity 0.8, rotate 2deg, elevated | Drop zone highlights |
| Dragged-over | Column highlights, insertion line | — |
| Overdue | Red left border, due date red | — |
| Due Soon | Amber left border | — |
| Assigned to me | Blue accent dot on avatar | — |
| Blocked (future) | Warning icon, muted | — |

### Task Detail Modal
| State | Behavior |
|-------|----------|
| Opening | Slide up + fade (200ms), focus trap, initial focus on title |
| Editing | Autosave on blur (debounced 500ms), dirty indicator |
| Saving | Inline spinner on save button, disable inputs |
| Saved | Toast "Saved", dirty cleared |
| Error | Inline error banner, retry button |
| Deleting | Confirmation dialog → loading → close modal + board update |
| Closing | Slide down + fade (150ms), restore focus to trigger |

### Board
| State | Behavior |
|-------|----------|
| Loading | Skeleton columns + cards (shimmer) |
| Empty Project | Illustration + "Create your first task" CTA |
| Empty Column | Dashed drop zone + "Drag tasks here" |
| Filter Active | Filter badge count, clear filter button |
| Offline | Banner "Offline — changes sync when online", queue mutations |
| Error | Inline banner per column/board, retry |

### Project List
| State | Behavior |
|-------|----------|
| Empty (no projects) | Illustration + "Create your first project" CTA |
| Loading | Skeleton project cards |
| Error | Retry banner |

---

## Edge Cases & Recovery Paths

| Scenario | Handling |
|----------|----------|
| **Network failure on drag** | Optimistic UI → revert on failure + toast "Move failed, try again" |
| **Concurrent edit conflict** | Last-write-wins with notification "Task updated by another user" |
| **Assignee removed from project** | Task unassigned, activity logged, assignee sees "No longer a member" |
| **Column deleted with tasks** | Tasks moved to first column, activity logged |
| **Project archived** | Read-only board, banner "Archived — restore to edit" |
| **Large board (100+ tasks)** | Virtualized columns, lazy-load cards |
| **Mobile drag** | Touch-friendly: long-press → drag, vibration feedback |
| **Keyboard-only user** | Full board navigable: Tab columns, Arrow keys move tasks, Enter edit |
| **Screen reader** | Live region announces moves, ARIA labels on all controls |

---

## Responsive Requirements

| Breakpoint | Layout |
|------------|--------|
| **≥1200px** | Full board: 5 columns side-by-side, comfortable density |
| **768–1199px** | 3 columns visible + horizontal scroll, or 2-col stacked |
| **480–767px** | Stacked columns (accordion), swipe between |
| **<480px** | Single column at a time, bottom sheet for task detail |

**Density Modes:** Compact (more tasks visible) / Comfortable (default) — persisted per user.

---

## Accessibility Requirements (WCAG 2.1 AA)

- **Keyboard:** All actions reachable, logical focus order, visible focus ring (2px, project primary)
- **Screen Reader:** Semantic HTML, ARIA live regions for drag announcements, proper labels
- **Color Contrast:** 4.5:1 text, 3:1 UI components (validated per project identity)
- **Motion:** Respects `prefers-reduced-motion` — disable animations, instant transitions
- **Touch Targets:** Minimum 44×44px on mobile
- **Zoom:** Functional at 200% zoom, no horizontal scroll

---

## Visual Requirements (Project-Specific)

**Domain:** Operations / Productivity → **Tone:** Clarity, focus, calm efficiency
**Energy:** Balanced (read-heavy with bursts of action)
**Sensitivity:** Standard (no PII/financial/health data)

**Derived Identity (from Blueprint-First rules):**
- Seed hue: ~210° (operational blue-teal)
- Saturation: ~50% (moderate, professional)
- Tone: **Clarity** — clean, scannable, purposeful
- Motion: Standard durations (220ms), respect reduced-motion
- Density: Comfortable default, compact option

**Component Budget:** 18 components (from visual system inventory)

---

## Design Completeness Checklist (Pre-Design)

- [x] Purpose & problem defined
- [x] Users & permission model complete
- [x] Features scoped (in/out justified)
- [x] Workflows mapped end-to-end
- [x] Entities normalized with relationships
- [x] Pages/screens inventoried with routes
- [x] Actions/interactions enumerated
- [x] States catalogued per component
- [x] Edge cases identified with recovery
- [x] Responsive breakpoints defined
- [x] Accessibility requirements specified
- [x] Visual identity derived from domain (not generic)
- [x] Component budget established

---

**Next:** Derive visual identity → tokens → component system → page specs → complete design.