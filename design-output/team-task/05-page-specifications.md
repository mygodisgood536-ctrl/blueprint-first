# TeamTask — Page Visual Specifications (Blueprint-First)

---

## Page 1: Project List / Dashboard (`/`)

### Route & Metadata
| Property | Value |
|----------|-------|
| **Route** | `/` |
| **Page Key** | `dashboard` |
| **Title** | "Projects" |
| **Purpose** | Overview of all accessible projects, create new project, quick access to recent |
| **Actor** | All (filtered by membership) |
| **Navigation** | Main nav: Home (active), Projects, Settings (admin) |

### Visual Hierarchy
1. **Page Title** (Display) — "Projects"
2. **Primary Action** — "Create Project" button (top right)
3. **Project Grid** — Cards in responsive grid
4. **Empty State** — Illustration + CTA (when no projects)

### Layout Structure
```
┌─────────────────────────────────────────────────────────────┐
│ Header (pageMargin)                                         │
│   Projects                              [Create Project]    │
├─────────────────────────────────────────────────────────────┤
│ Project Grid (12-col, gap 24px)                             │
│   ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐          │
│   │Project 1│ │Project 2│ │Project 3│ │Project 4│  ← Cards │
│   │ Card    │ │ Card    │ │ Card    │ │ Card    │          │
│   └─────────┘ └─────────┘ └─────────┘ └─────────┘          │
│                                                             │
│   (empty state if 0 projects)                               │
└─────────────────────────────────────────────────────────────┘
```

### Focal Point
**Create Project button** (top right) for new users; **first project card** for returning users.

### Primary Action
**"Create Project"** — Primary button, top right of header. Opens Create Project modal.

### Secondary Actions
- Project card click → Navigate to board
- Project card menu (⋮) → Settings, Archive, Delete (admin)

### Header Treatment
Minimal: Title left, primary action right. Breadcrumb not needed (root level).

### Component Usage
| Component | Instance | Purpose |
|-----------|----------|---------|
| Button (Primary, lg) | 1 | Create Project |
| Card (Project) | N (0–∞) | Project overview |
| Empty State | 1 (conditional) | No projects onboarding |
| Avatar (stacked) | Per card | Member avatars |
| Badge | Per card | Task count, member count |
| Skeleton | Per card (loading) | Loading placeholder |
| IconButton | Per card (⋮) | Project actions menu |

### Responsive Strategy
| Breakpoint | Grid Columns | Behavior |
|------------|--------------|----------|
| ≥1200px | 4 | Comfortable 4-col |
| 768–1199px | 3 | 3-col, horizontal scroll if needed |
| 480–767px | 2 | 2-col stacked |
| <480px | 1 | Single column, full width |

### Loading Strategy
Skeleton cards (3–4) with shimmer. Staggered appear (50ms delay each).

### Empty State
Illustration: "Clipboard + plus" → Title: "No projects yet" → Description: "Create your first project to start organizing tasks with your team" → Action: "Create Project" (Primary, lg)

### Error State
Banner at top: "Failed to load projects" + "Retry" button. Preserve any created project optimistically.

### Success State
Toast: "Project created" (2s) → New project card animates in (220ms enter).

---

## Page 2: Kanban Board (`/projects/:id/board`)

### Route & Metadata
| Property | Value |
|----------|-------|
| **Route** | `/projects/:id/board` |
| **Page Key** | `board` |
| **Title** | Project name (dynamic) |
| **Purpose** | Primary task management — visualize workflow, move tasks, create/edit |
| **Actor** | Member, Admin (Viewer = read-only) |
| **Navigation** | Breadcrumb: Projects > [Project Name] > Board |

### Visual Hierarchy
1. **Project Header** — Name, member count, settings (admin)
2. **Toolbar** — Filter, Search, Density, View Options
3. **Column Headers** — Name, task count, WIP limit indicator
4. **Task Cards** — In columns, ordered by position
5. **Column Footers** — "+ Add Task" per column
6. **FAB** — Global "Create Task" (mobile)

### Layout Structure
```
┌─────────────────────────────────────────────────────────────────────┐
│ Header (sticky, elevation 1)                                        │
│   ◀ Projects    Project Name (heading)    [Filter] [Density] [⚙]   │
├─────────────────────────────────────────────────────────────────────┤
│ Toolbar (sticky, elevation 1)                                       │
│   [Search...]    [Assignee ▼] [Due ▼] [Points ▼] [Clear]  [View]   │
├─────────────────────────────────────────────────────────────────────┤
│ Board Scroll Container (horizontal scroll, gap 24px)                │
│ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌────────────┐ │
│ │ BACKLOG (3)  │ │ TO DO (5)    │ │ IN PROG (2)  │ │ IN REVIEW  │ │
│ │ ▼ WIP: 5     │ │ ▼ WIP: 8     │ │ ▼ WIP: 3     │ │ (1)        │ │
│ ├──────────────┤ ├──────────────┤ ├──────────────┤ ├────────────┤ │
│ │ [+]          │ │ [+]          │ │ [+]          │ │ [+]        │ │
│ │ ┌─────────┐  │ │ ┌─────────┐  │ │ ┌─────────┐  │ │ ┌────────┐ │ │
│ │ │ Task 1  │  │ │ │ Task 3  │  │ │ │ Task 5  │  │ │ │ Task 7 │ │ │
│ │ │ ▸ 3pts  │  │ │ │ ▸ 2pts  │  │ │ │ ▸ 5pts  │  │ │ │ ▸ 1pt  │ │ │
│ │ └─────────┘  │ │ └─────────┘  │ │ └─────────┘  │ │ └────────┘ │ │
│ │ ┌─────────┐  │ │ ┌─────────┐  │ │            │ │ │          │ │
│ │ │ Task 2  │  │ │ │ Task 4  │  │ │            │ │ │          │ │
│ │ │ ▸ 1pt   │  │ │ │ ▸ 8pts  │  │ │            │ │ │          │ │
│ │ └─────────┘  │ │ └─────────┘  │ │            │ │ │          │ │
│ │ [+ Add Task] │ │ [+ Add Task] │ │ [+ Add Task] │ │ [+ Add]    │ │
│ └──────────────┘ └──────────────┘ └──────────────┘ └────────────┘ │
├─────────────────────────────────────────────────────────────────────┤
│ FAB (mobile only): [+ Create Task]                                  │
└─────────────────────────────────────────────────────────────────────┘
```

### Focal Point
**First task in "To Do" column** (or "Backlog" if empty) — receives subtle highlight + scroll into view on load.

### Primary Action
**"Create Task"** — FAB (mobile) / Column "+ Add Task" / Toolbar "Create" button. Opens Create Task modal.

### Secondary Actions
- Filter toolbar (search, assignee, due, points)
- Density toggle (Compact/Comfortable)
- Column menu (⋮) — Rename, WIP limit, Delete (admin)
- Task card drag → move
- Task card click → Detail modal
- Task quick actions (⋮) — Edit, Move, Duplicate, Archive, Delete

### Header Treatment
Sticky header with project name (heading), back link, member avatars (stacked, max 4), settings (admin). Elevation 1 when scrolled.

### Toolbar
Sticky below header. Search input (primary), filter dropdowns (IconButton + Select), density toggle (Radio group), view options (IconButton), clear filters (Ghost button, visible only when active).

### Component Usage
| Component | Instance | Purpose |
|-----------|----------|---------|
| Button (Icon, Ghost) | Toolbar actions | Filter, Density, View, Settings |
| Button (Primary, md) | Create Task (toolbar) | Global create |
| Button (Ghost, sm) | Column "+ Add Task" | Column-level create |
| Input (search) | 1 | Task search |
| Select | 3 (Assignee, Due, Points) | Filters |
| Badge | Per column header | Task count |
| Badge | Per task card | Points, Due status |
| Card (Task) | N per column | Task representation |
| Avatar | Per task card | Assignee |
| IconButton | Per task card (⋮) | Quick actions |
| IconButton | Per column header (⋮) | Column actions |
| Dropdown Menu | Task + Column | Action menus |
| Dialog (md) | Task Detail, Create Task | Modals |
| Skeleton | Per card (loading) | Loading |
| Empty State | Per column (empty) | Drop zone hint |
| Tooltip | Icon-only buttons | Labels |
| FAB | Mobile only | Create Task |
| Alert | Top banner | Errors, offline |

### Drag & Drop Specification
| Aspect | Behavior |
|--------|----------|
| **Drag Initiation** | Long press (300ms) on mobile / Click drag handle on desktop |
| **Ghost Card** | Opacity 0.8, rotate(2deg), elevation 3, exact card clone |
| **Drop Zones** | Column areas highlight (primary 10% bg), insertion line between cards |
| **Reorder** | Within column: insertion line follows cursor |
| **Cross-column** | Column header highlights, auto-scroll at edges |
| **Invalid Drop** | Ghost snaps back (150ms), toast "Can't move there" |
| **Optimistic** | Immediate visual move, revert on failure + toast |
| **Keyboard** | Space to pick up, Arrow keys to navigate columns/cards, Enter to drop, Esc to cancel |
| **Touch** | Vibration on pick-up (mobile), 44×44px drag handle |

### Column Configuration (Default, Customizable)
| Order | Name | WIP Limit | Color Accent |
|-------|------|-----------|--------------|
| 1 | Backlog | 10 | Muted |
| 2 | To Do | 8 | Info |
| 3 | In Progress | 5 | Primary |
| 4 | In Review | 3 | Warning |
| 5 | Done | — | Success |

### Responsive Strategy
| Breakpoint | Layout |
|------------|--------|
| ≥1200px | 5 columns side-by-side, horizontal scroll if needed |
| 768–1199px | 3 columns visible + horizontal scroll (touch drag scroll) |
| 480–767px | Stacked accordion columns (tap to expand/collapse) |
| <480px | Single column view + bottom sheet for task detail, FAB for create |

**Mobile Accordion:**
- Column headers always visible
- Tap header → expand/collapse (220ms height animation)
- Swipe left/right between expanded columns
- FAB fixed bottom-right for create

### Loading Strategy
- Board skeleton: 5 column skeletons + 3 card skeletons each
- Staggered column appear (100ms each)
- Toolbar loads instantly, filters populate async

### Empty States
| Context | Illustration | Title | Action |
|---------|--------------|-------|--------|
| Empty Project | Kanban columns | "Board is empty" | "Create Task" (Primary) |
| Empty Column | Dashed drop zone | "Drag tasks here" or "+ Add Task" | Inline create |
| No Filter Results | Search + slash | "No tasks match filters" | "Clear filters" |

### Error States
| Scenario | Behavior |
|----------|----------|
| Network failure (load) | Banner: "Failed to load board" + Retry |
| Drag failure | Ghost snaps back + toast "Move failed" |
| Save failure (modal) | Inline error in modal + toast, preserve input |
| Offline | Persistent banner "Offline — changes sync when online", queue mutations |

### Success States
| Action | Feedback |
|--------|----------|
| Task created | Toast "Task created" + card animates in (220ms enter) |
| Task moved | Immediate visual, toast "Moved to [Column]" (1s) |
| Task updated | Toast "Saved" (1.5s) |
| Task deleted | Toast "Task deleted" + undo (3s) |
| Filter applied | Subtle toolbar highlight, results update |

---

## Page 3: Task Detail Modal (`/projects/:id/tasks/:taskId` — Modal)

### Route & Metadata
| Property | Value |
|----------|-------|
| **Route** | Modal over board (deep linkable) |
| **Page Key** | `task-detail` |
| **Title** | Task title (dynamic) |
| **Purpose** | View/edit full task details, comments, activity |
| **Actor** | All (Viewer = read-only) |

### Visual Hierarchy (Modal md, 560px)
1. **Header** — Title (editable), Column badge, Close
2. **Body Sections** (vertical, gap 24px):
   - Description (editable)
   - Metadata Row: Assignee, Due Date, Points, Column
   - Comments (list + add form)
   - Activity Log (table, collapsible)
3. **Footer** — Delete (admin, destructive), Close, Save (if dirty)

### Layout Structure
```
┌─────────────────────────────────────────────────────────────┐
│ Header                                                        │
│   [Title Input]                    [Column Badge]    [✕]    │
├─────────────────────────────────────────────────────────────┤
│ Body (scrollable, max-height 70vh)                            │
│ ┌─────────────────────────────────────────────────────────┐  │
│ │ Description                                             │  │
│ │ [Textarea, min-height 100px, auto-resize]              │  │
│ └─────────────────────────────────────────────────────────┘  │
│ ┌─────────────────────────────────────────────────────────┐  │
│ │ Metadata Row (gap 24px)                                 │  │
│ │ [Assignee ▼]    [Due Date 📅]    [Points ▼]    [Column ▼]│  │
│ └─────────────────────────────────────────────────────────┘  │
│ ┌─────────────────────────────────────────────────────────┐  │
│ │ Comments (List)                                         │  │
│ │ ┌─────────────────────────────────────────────────────┐ │  │
│ │ │ [Avatar] Author          2h ago                     │ │  │
│ │ │ Comment text...                                     │ │  │
│ │ └─────────────────────────────────────────────────────┘ │  │
│ │ [Add Comment: Textarea + Submit Button]                │  │
│ └─────────────────────────────────────────────────────────┘  │
│ ┌─────────────────────────────────────────────────────────┐  │
│ │ Activity Log (Table, collapsible, default collapsed)    │  │
│ │ Timestamp | Action | Actor | Details                     │  │
│ └─────────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────┤
│ Footer (sticky, elevation 1)                                  │
│   [Delete] (destructive, admin)          [Close] [Save]      │
└─────────────────────────────────────────────────────────────┘
```

### Focal Point
**Title input** (auto-focus on open, select all for quick rename)

### Primary Action
**"Save"** (Primary, md) — Visible only when dirty. Autosave on blur (500ms debounce) also supported.

### Secondary Actions
- **Close** (Ghost) — Discard changes if dirty (confirmation)
- **Delete** (Destructive, admin only) — Confirmation dialog
- **Column/Assignee/Due/Points dropdowns** — Inline edit
- **Add Comment** — Textarea + Submit (Primary, sm)

### Header Treatment
Modal header with editable title (Input, heading font), column badge (Badge, current column color), close IconButton.

### Component Usage
| Component | Instance | Purpose |
|-----------|----------|---------|
| Input | 1 (title) | Editable task title |
| Textarea | 1 (description) + 1 (comment) | Rich text areas |
| Select | 4 (Assignee, Due, Points, Column) | Metadata dropdowns |
| DatePicker | 1 (due date) | Calendar popover |
| Avatar | Per comment + assignee | User representation |
| Button (Primary) | Save, Submit Comment | Primary actions |
| Button (Ghost) | Close | Dismiss |
| Button (Destructive) | Delete | Admin only |
| Badge | Column, Points, Due status | Metadata chips |
| List | Comments | Comment thread |
| Table | Activity log | History |
| Alert | Inline (validation, save error) | Feedback |
| Skeleton | Loading | Initial load |

### States
| State | Behavior |
|-------|----------|
| **Opening** | Slide up + fade (220ms), focus trap, focus title |
| **Editing** | Dirty indicator (dot on Save), autosave on blur |
| **Saving** | Save button: spinner, disabled, width locked |
| **Saved** | Toast "Saved", dirty cleared, updated timestamp |
| **Error** | Inline alert + toast, focus first error, preserve input |
| **Deleting** | Confirm dialog → loading → close modal + board update |
| **Closing** | If dirty: confirm "Discard changes?" → slide down (150ms) |
| **Read-only (Viewer)** | All inputs disabled, no Save/Delete, no comment form |

### Responsive Strategy
- Desktop/Tablet: Modal centered, max-width 560px
- Mobile: Full-screen bottom sheet (Drawer pattern), swipe to dismiss

### Loading Strategy
- Skeleton for each section (title, description, metadata, comments, activity)
- Comments + activity load async after modal opens

### Empty States
| Context | Handling |
|---------|----------|
| No description | Placeholder: "Add a description..." |
| No comments | "No comments yet. Start the conversation." |
| No activity | "No activity recorded" (collapsed by default) |

### Error States
| Scenario | Handling |
|----------|----------|
| Validation error | Inline field error + summary alert at top |
| Save conflict | "Task updated by another user" + refresh button |
| Network failure | Toast "Failed to save" + retry on Save button |

---

## Page 4: Create Task Modal (`/projects/:id/tasks/new` — Modal)

### Route & Metadata
| Property | Value |
|----------|-------|
| **Route** | Modal over board |
| **Page Key** | `create-task` |
| **Title** | "Create Task" |
| **Purpose** | Quick task creation with required fields |
| **Actor** | Member, Admin |

### Visual Hierarchy
1. **Header** — "Create Task", Close
2. **Form** (vertical, gap 16px):
   - Title (required, Input)
   - Description (optional, Textarea)
   - Metadata Row: Assignee (Select, default: me), Due Date (DatePicker), Points (Select), Column (Select, default: first)
3. **Footer** — Cancel (Ghost), Create (Primary)

### Layout Structure
```
┌─────────────────────────────────────────────────────────────┐
│ Header: Create Task                                    [✕]  │
├─────────────────────────────────────────────────────────────┤
│ Form                                                          │
│   Title *          [______________________________]         │
│   Description      [______________________________]         │
│                    [______________________________]         │
│   ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐      │
│   │ Assignee │ │ Due Date │ │ Points   │ │ Column   │      │
│   │ [Me ▼]   │ │ [📅]     │ │ [3 ▼]    │ │ [Backlog▼]│      │
│   └──────────┘ └──────────┘ └──────────┘ └──────────┘      │
├─────────────────────────────────────────────────────────────┤
│ Footer: [Cancel]                              [Create Task]  │
└─────────────────────────────────────────────────────────────┘
```

### Focal Point
**Title input** (auto-focus, required)

### Primary Action
**"Create Task"** (Primary, md) — Disabled until title filled. On submit: loading → close modal + board update.

### Secondary Actions
- **Cancel** (Ghost) — If dirty: confirm "Discard changes?"
- **Assignee default** — Current user
- **Column default** — First column (Backlog)
- **Points default** — 3

### Validation
| Field | Rule | Error Message |
|-------|------|---------------|
| Title | Required, max 200 chars | "Title is required" / "Title too long" |
| Description | Optional, max 5000 chars | "Description too long" |
| Due Date | Optional, valid date | "Invalid date" |
| Points | One of [1,2,3,5,8] | (Select enforces) |
| Column | Must exist in project | (Select enforces) |

### Component Usage
| Component | Instance |
|-----------|----------|
| Input | 1 (title) |
| Textarea | 1 (description) |
| Select | 3 (Assignee, Points, Column) |
| DatePicker | 1 (due date) |
| Button (Primary) | Create Task |
| Button (Ghost) | Cancel |
| Alert | Validation summary / error |
| Skeleton | Loading assignee list |

---

## Page 5: Project Settings (`/projects/:id/settings`)

### Route & Metadata
| Property | Value |
|----------|-------|
| **Route** | `/projects/:id/settings` |
| **Page Key** | `settings` |
| **Title** | "Settings — [Project Name]" |
| **Purpose** | Configure project, members, columns, danger zone |
| **Actor** | Admin only |

### Visual Hierarchy
1. **Header** — Back to board, Project name, Save indicator
2. **Tabs** — General, Members, Columns, Danger Zone
3. **Tab Panels** — Form sections per tab

### Tab: General
| Section | Fields |
|---------|--------|
| Project Info | Name (Input, required), Description (Textarea) |
| Avatar | Upload (future), Current preview |
| Actions | [Save Changes] (Primary), [Cancel] (Ghost) |

### Tab: Members
| Section | Fields |
|---------|--------|
| Current Members | Table: Avatar, Name, Role (Select: Admin/Member/Viewer), Actions (Remove) |
| Invite Member | Email (Input), Role (Select), [Send Invite] (Primary) |
| Pending Invites | List: Email, Role, [Resend] [Cancel] |

### Tab: Columns
| Section | Fields |
|---------|--------|
| Column List | Reorderable (drag handle): Name (Input), WIP Limit (Number Input), Color (swatch), [Delete] (IconButton, destructive) |
| Add Column | [+ Add Column] → Inline row |
| Actions | [Save Column Config] (Primary) |

### Tab: Danger Zone
| Section | Actions |
|---------|---------|
| Archive Project | [Archive] (Warning variant) — Confirm modal |
| Delete Project | [Delete] (Destructive) — Double confirm modal (type project name) |

### Component Usage
| Component | Instance |
|-----------|----------|
| Tabs | 4 tabs |
| Input | Name, Email, Column names |
| Textarea | Description |
| Select | Role, Column (for default) |
| Switch | WIP limit enabled, Notifications |
| Table | Members, Pending invites |
| Button | Save, Invite, Add Column, Archive, Delete |
| Alert | Unsaved changes banner, confirmations |
| Dialog | Confirm archive/delete |
| Badge | Role badges in member table |

### Responsive
- Desktop: Tabs horizontal, side-by-side forms
- Tablet: Tabs scrollable, forms stacked
- Mobile: Tabs → Accordion sections

---

## Page 6: Member Invite Flow (Modal)

### Route & Metadata
| Property | Value |
|----------|-------|
| **Route** | Modal from Settings > Members |
| **Page Key** | `invite-member` |
| **Title** | "Invite Member" |
| **Actor** | Admin |

### Layout
```
┌─────────────────────────────────────────────────────────────┐
│ Invite Member                                          [✕]  │
├─────────────────────────────────────────────────────────────┤
│ Email *          [______________________________]          │
│ Role             [Member ▼]  (Admin / Member / Viewer)     │
│ Message (opt)    [______________________________]          │
│                    [______________________________]          │
├─────────────────────────────────────────────────────────────┤
│ [Cancel]                                    [Send Invite]    │
└─────────────────────────────────────────────────────────────┘
```

### Validation
- Email: required, valid format, not already member/pending
- Role: required

---

## Page 7: Mobile Board (`/projects/:id/board` — Mobile View)

### Breakpoint: <768px

### Layout Changes from Desktop
| Element | Desktop | Mobile |
|---------|---------|--------|
| Columns | Side-by-side horizontal | Stacked accordion |
| Toolbar | Full row | Collapsible (tap to expand) |
| Task Detail | Modal (560px) | Full-screen Drawer (bottom sheet) |
| Create Task | Column "+" / Toolbar | FAB (bottom right) |
| Drag | Mouse drag | Long press → drag, vibration |
| Scroll | Horizontal board scroll | Vertical column scroll + swipe between |

### Mobile Accordion Columns
- All column headers always visible (sticky within scroll)
- Tap header → expand/collapse (220ms height animation, easing enter/exit)
- Only one expanded at a time (accordion) OR multiple (configurable)
- Collapsed header shows: Name, task count, WIP indicator, [+ Add] button
- Expanded: Full card stack, scrollable within column

### FAB (Create Task)
- Fixed bottom-right (24px from edges)
- 56×56px, Primary, elevation 3
- Icon: Plus (24px)
- Tap → Create Task Modal (full-screen bottom sheet)

### Touch Targets
- All interactive: minimum 44×44px
- Drag handle: 44×44px touch area
- Column headers: full width tap target

---

## Cross-Page Consistency Rules

| Rule | Enforcement |
|------|-------------|
| Header height | 64px (desktop), 56px (mobile) |
| Page margin | 24px (desktop), 16px (mobile) |
| Section gap | 48px (desktop), 32px (mobile) |
| Component gap | 16px (desktop), 12px (mobile) |
| Modal width | 560px max (desktop), 100vw (mobile) |
| Focus ring | 2px `--color-focus` on ALL interactive |
| Loading | Skeleton matching final layout |
| Empty | Illustration + Title + Description + Primary Action |
| Error | Banner + inline + toast, preserve input |
| Success | Toast (2s) + subtle UI update |

---

## Page Quality Checklist (Per Page)

- [x] Visual hierarchy documented (1–5)
- [x] Focal point identified
- [x] Primary action defined
- [x] Secondary actions enumerated
- [x] Header treatment specified
- [x] Responsive strategy per breakpoint
- [x] Loading strategy (skeleton + stagger)
- [x] Empty states (illustration, title, description, action)
- [x] Error states (banner, inline, toast, recovery)
- [x] Success states (toast, animation, undo where applicable)
- [x] Component inventory complete
- [x] All states covered (default, hover, focus, pressed, disabled, loading, selected, error, empty)
- [x] A11y: focus management, ARIA, keyboard, contrast, touch targets
- [x] Motion specified per interaction
- [x] Reduced-motion behavior defined