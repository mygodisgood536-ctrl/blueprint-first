# TeamTask — Component Design System (Blueprint-First)

## Component Inventory (18 Components — Derived from Project Model)

| Component | Purpose | Used By Pages |
|-----------|---------|---------------|
| **Button** | Primary/secondary/destructive actions | All |
| **IconButton** | Compact actions (drag, menu, close) | Board, Task Card, Modal |
| **Input** | Text, date, number, search | Task Detail, Create Task, Filters |
| **Textarea** | Task description, comments | Task Detail, Create Task |
| **Select** | Assignee, column move, points, filters | Task Detail, Create Task, Board Filters |
| **Checkbox** | Bulk select, filter multi-select | Board, Filters |
| **Radio** | Density mode, column config | Settings |
| **Switch** | Column WIP limits, notifications | Settings |
| **Card** | Task cards, project cards | Board, Dashboard |
| **Table** | Activity log, member list | Task Detail, Settings |
| **List** | Comments, notifications | Task Detail |
| **Dialog/Modal** | Task detail, create task, confirm delete | Board, Task Card |
| **Drawer** | Mobile task detail, filters | Mobile Board |
| **Alert/Banner** | Errors, warnings, success, info | All |
| **Badge** | Points, due status, filter counts | Task Card, Filters |
| **Tooltip** | Icon-only buttons, truncated text | Board, Toolbar |
| **Breadcrumb** | Project > Board navigation | Board, Settings |
| **Pagination** | Member list, activity log | Settings, Task Detail |
| **Avatar** | Assignee, comment author | Task Card, Task Detail, Comments |
| **Dropdown Menu** | Column actions, task quick actions | Board, Task Card |
| **Tabs** | Column config, settings sections | Settings |
| **Date Picker** | Due date selection | Task Detail, Create Task |
| **Empty State** | No projects, no tasks, no results | Dashboard, Board, Filters |
| **Skeleton** | Loading placeholders | All |
| **Progress/Spinner** | Saving, loading, drag feedback | All |

---

## Component Specifications (Complete Per-Component)

### 1. Button

**Anatomy:** Container → Label + Optional Leading Icon + Optional Trailing Icon/Spinner

**Variants:**
| Variant | Use Case | Visual |
|---------|----------|--------|
| **Primary** | Main CTA (Create, Save, Confirm) | Primary bg, white text, elevation 1 |
| **Secondary** | Alternative actions (Cancel, Back) | Surface bg, primary border, primary text |
| **Destructive** | Delete, Archive, Remove | Danger bg, white text |
| **Ghost** | Subtle actions (Filter, Density) | Transparent, primary text, hover: surfaceAlt |
| **Icon Only** | Drag handle, close, menu | 40×40px, transparent, icon only |

**Sizes:**
| Size | Height | Padding | Font | Use Case |
|------|--------|---------|------|----------|
| **sm** | 32px | 8px 12px | Caption | Inline, toolbar, dense |
| **md** | 40px | 10px 16px | Body | Default, forms, modals |
| **lg** | 48px | 12px 20px | Body | Primary page CTA, hero |

**States (All Variants):**
| State | Visual | Motion |
|-------|--------|--------|
| Default | Per variant | — |
| Hover | Primary: primaryHover; Secondary: surfaceAlt; Destructive: dangerHover; Ghost: surfaceAlt | 150ms color |
| Focus | 2px solid focus ring, offset 2px | 150ms ring |
| Pressed | Primary: primaryPressed; Secondary: surfaceContrast; Destructive: dangerPressed | 0ms (instant) |
| Disabled | disabledBg, disabledText, cursor not-allowed | — |
| Loading | Spinner replaces label, width locked, disabled | Spinner 600ms linear |
| Success | Success bg, check icon, white text (2s then revert) | 150ms color |

**A11y:** `type="button"`, `aria-disabled`, `aria-busy` when loading, visible focus, 44×44px min touch

**Content Rules:** Imperative verb ("Create Task"), sentence case, no trailing punctuation

---

### 2. IconButton

**Anatomy:** 40×40px (md) / 32×32px (sm) circular container → Icon (20px/16px)

**Variants:** Ghost (default), Primary (for primary icon actions), Destructive (delete)

**States:** Same as Button, plus:
| State | Visual |
|-------|--------|
| Selected/Active | Primary bg, white icon (e.g., active filter) |
| Expanded | `aria-expanded="true"`, rotated chevron |

**A11y:** `aria-label` required, `aria-expanded`/`aria-haspopup` for menus, tooltip on hover/focus

---

### 3. Input

**Anatomy:** Label → Field (with optional leading/trailing icon) → Helper Text / Error Message

**Types:** text, email, date, number, search, password

**Sizes:** md (40px), sm (32px)

**States:**
| State | Visual |
|-------|--------|
| Default | border, surface bg |
| Hover | border darker 10% |
| Focus | 2px focus ring, border: primary |
| Filled/Valid | border, optional success icon trailing |
| Error | border: danger, error message below, `aria-invalid="true"`, `aria-describedby` |
| Disabled | disabledBg, disabledText, cursor not-allowed |
| Read-only | surfaceAlt, no focus ring, copyable |

**A11y:** `<label for=id>`, `aria-describedby` for helper/error, `autocomplete` where appropriate, `type="date"` uses native picker

---

### 4. Textarea

**Anatomy:** Label → Field (resizable, min-height 100px) → Character count (optional) → Helper/Error

**States:** Same as Input

**A11y:** Same as Input, `rows` attribute for baseline height

---

### 5. Select

**Anatomy:** Label → Field (with chevron) → Native `<select>` or Custom Dropdown → Helper/Error

**Options:** Assignee (avatar + name), Column (name), Points (1/2/3/5/8), Density (Compact/Comfortable), Filter multi-select

**States:** Same as Input, plus:
| State | Visual |
|-------|--------|
| Open | Focus ring retained, chevron rotated 180° (150ms) |

**A11y:** Native `<select>` preferred; custom: `role="combobox"`, `aria-expanded`, keyboard navigation (arrows, Enter, Esc)

---

### 6. Checkbox

**Anatomy:** 20×20px box → Check glyph (16px) → Label

**States:**
| State | Visual |
|-------|--------|
| Unchecked | Border, transparent bg |
| Hover | Border: primary, bg: primary 10% |
| Focus | 2px focus ring |
| Checked | Primary bg, white check, border: primary |
| Indeterminate | Primary bg, white minus glyph |
| Disabled | disabledBg, disabledText, cursor not-allowed |

**A11y:** Native `<input type="checkbox">`, `aria-describedby` for group label

---

### 7. Radio

**Anatomy:** 20×20px circle → Dot (10px) → Label

**States:** Same as Checkbox (Checked = primary dot + border)

**A11y:** Native `<input type="radio">`, shared `name` for group, `fieldset`/`legend` or `role="radiogroup"`

---

### 8. Switch

**Anatomy:** 44×24px track → 20×20px thumb → Label (optional)

**States:**
| State | Visual | Motion |
|-------|--------|--------|
| Off | Border track, thumb left | — |
| Hover | Track: primary 20% | — |
| Focus | 2px focus ring | — |
| On | Primary track, thumb right | 220ms thumb slide (enter easing) |
| Disabled | disabledBg track, disabledText | — |

**A11y:** `role="switch"`, `aria-checked`, native `<input type="checkbox">` visually hidden

---

### 9. Card (Task Card / Project Card)

**Anatomy:** Container (elevation 1) → Header (optional) → Body → Footer (optional)

**Task Card Layout:**
```
┌─────────────────────────────────────┐
│ [Drag Handle] Title              [⋮] │  ← Header (optional)
├─────────────────────────────────────┤
│ Description (2 lines max, clamp)    │  ← Body
├─────────────────────────────────────┤
│ [Avatar] Assignee   [Points] [Due]  │  ← Footer metadata
└─────────────────────────────────────┘
```

**Project Card Layout:**
```
┌─────────────────────────────────────┐
│ Project Name                        │
│ Description (1 line)                │
├─────────────────────────────────────┤
│ [Member avatars]  5 members  ▸      │
└─────────────────────────────────────┘
```

**States:**
| State | Visual | Motion |
|-------|--------|--------|
| Default | Elevation 1, surface bg | — |
| Hover | Elevation 2, translateY(-2px) | 220ms enter |
| Dragging | Opacity 0.8, rotate(2deg), elevation 3 | 0ms |
| Drop Target | Column: bg pulse, insertion line | 150ms pulse |
| Selected | Primary border (2px), elevation 2 | 150ms |
| Empty Column | Dashed border, "Drag tasks here" text | — |

**A11y:** `role="article"`, `aria-label` with task title + status, keyboard: Enter → detail, Arrow keys → move between cards, Space → select for bulk

**Content Rules:** Title max 2 lines (clamp), description max 2 lines, metadata single line

---

### 10. Table (Activity Log / Member List)

**Anatomy:** `<table>` → `<caption>` → `<thead>` → `<tbody>` → `<tfoot>` (optional)

**Columns:** Timestamp, Action, Actor, Details (Activity) / Name, Role, Joined (Members)

**States:**
| State | Visual |
|-------|--------|
| Row Hover | surfaceAlt bg |
| Row Selected | selected bg, selectedText |
| Sortable Header | Chevron icon, hover: primary text |
| Sorted | Chevron filled, primary color |
| Empty | Empty state illustration centered |

**A11y:** `<th scope="col">`, `<caption>`, keyboard sortable (Enter/Space), `aria-sort`

---

### 11. List (Comments)

**Anatomy:** `<ul>` → `<li>` (Comment) → Avatar + Author + Timestamp + Content

**States:**
| State | Visual |
|-------|--------|
| Hover | surfaceAlt bg (subtle) |
| Own Comment | Primary left border (3px) |
| Empty | Empty state: "No comments yet" |

**A11y:** `<article>` per comment, `aria-label` with author + time, live region for new comments

---

### 12. Dialog/Modal (Task Detail, Create Task, Confirm Delete)

**Anatomy:** Backdrop → Container (elevation 3, radius modal) → Header (Title + Close) → Body → Footer (Actions)

**Sizes:**
| Size | Max Width | Use Case |
|------|-----------|----------|
| **sm** | 400px | Confirm dialogs |
| **md** | 560px | Task detail, create task (default) |
| **lg** | 720px | Settings panels |

**States:**
| State | Visual | Motion |
|-------|--------|--------|
| Opening | Opacity 0→1, scale 0.95→1, translateY(10px→0) | 220ms enter |
| Open | Focus trapped, initial focus on first input/close | — |
| Closing | Opacity 1→0, scale 1→0.95, translateY(0→10px) | 150ms exit |
| Error | Inline alert in body, focus on first error | — |

**A11y:** `role="dialog" aria-modal="true" aria-labelledby="title"`, focus trap, Esc closes, restore focus on close, backdrop click closes (except confirm delete)

---

### 13. Drawer (Mobile Task Detail, Filters)

**Anatomy:** Backdrop → Panel (full height, 100vw mobile / 360px desktop) → Header → Body → Footer

**Motion:** Slide from right (220ms enter) / slide to right (150ms exit)

**A11y:** Same as Dialog, plus swipe-to-dismiss on mobile

---

### 14. Alert/Banner

**Anatomy:** Icon → Title → Body (optional) → Dismiss (optional) → Actions (optional)

**Variants:**
| Variant | Icon | Border/Background | Role |
|---------|------|-------------------|------|
| **Success** | Check circle | success left border + tinted surface | Confirmation |
| **Warning** | Alert triangle | warning left border | Caution |
| **Error** | X circle | danger left border + `role="alert"` | Errors |
| **Info** | Info circle | info left border | Hints, tips |

**Motion:** Appear 150ms enter, dismiss 150ms exit (fade + translateX)

**A11y:** `role="alert"` for error/warning, live region, dismissible via button

---

### 15. Badge

**Anatomy:** Container (radius surface, padding 4px 8px) → Text + Optional Dot

**Variants:**
| Variant | Visual | Use Case |
|---------|--------|----------|
| **Default** | surfaceContrast bg, mutedText | Generic labels |
| **Success** | success 10% bg, success text | Done, completed |
| **Warning** | warning 10% bg, warning text | Due soon, in review |
| **Danger** | danger 10% bg, danger text | Overdue, blocked |
| **Info** | info 10% bg, info text | New, unread |
| **Points** | Primary bg, white text, font-mono | Story points (1/2/3/5/8) |

**Sizes:** sm (20px height, caption), md (24px height, body)

**A11y:** Text conveys meaning (not color alone), sufficient contrast

---

### 16. Tooltip

**Anatomy:** Anchor → Bubble (elevation 2, radius surface, padding 8px) → Arrow (6px)

**Placement:** Top (default), bottom, left, right — auto-flip within viewport

**Trigger:** Hover (300ms delay) + Focus (instant)

**Content:** Max 120 chars, single line preferred

**Motion:** 150ms opacity + translateY(-4px)

**A11y:** `aria-describedby` on anchor, hidden from SR when decorative

---

### 17. Breadcrumb

**Anatomy:** `<nav aria-label="Breadcrumb">` → `<ol>` → `<li>` (Link / Current)

**Visual:** Caption text, mutedText links, text current, chevron separator (6px gap)

**Responsive:** Hide intermediate crumbs <640px, show only first + last + current

**A11y:** `aria-current="page"` on current, semantic nav

---

### 18. Pagination

**Anatomy:** Previous → Page numbers (with ellipsis) → Next → Count

**States:** Current page (primary filled), disabled prev/next at bounds

**Responsive:** <480px → Prev/Next only + page input

**A11y:** `aria-current="page"`, `aria-label` on prev/next, keyboard navigation

---

### 19. Avatar

**Anatomy:** Circle (32px/24px/40px) → Image or Initials (fallback)

**Sizes:** sm (24px), md (32px), lg (40px), xl (48px)

**States:**
| State | Visual |
|-------|--------|
| Image | object-fit: cover |
| Initials | Primary bg, white text, heading font |
| Stacked | Overlap -8px, border: surface 2px, max 4 + "+N" |

**A11y:** `alt=""` for decorative, `alt="Name"` for meaningful, `role="img"`

---

### 20. Dropdown Menu

**Anatomy:** Trigger (IconButton) → Panel (elevation 2, radius card, min-width 200px) → Items (Icon + Label + Shortcut) → Dividers → Danger section

**Items:** Edit, Move, Duplicate, Archive, Delete (destructive)

**Motion:** 150ms enter (opacity + scale 0.95→1), 150ms exit

**A11y:** `role="menu"`, `role="menuitem"`, keyboard (arrows, Enter, Esc), focus trap, `aria-haspopup="menu"` on trigger

---

### 21. Tabs

**Anatomy:** `<div role="tablist">` → Buttons (`role="tab"`) → Panels (`role="tabpanel"`)

**Visual:** Border-bottom on active (primary, 3px), mutedText inactive, primary active

**Keyboard:** Arrow keys navigate, Home/End, Enter/Space activates (auto or manual)

**A11y:** `aria-selected`, `aria-controls`, `id`/`aria-labelledby` linkage

---

### 22. Date Picker

**Anatomy:** Input (readonly) → Calendar Popover (month grid, header nav, today button)

**Behavior:** Native `<input type="date">` on mobile; custom popover on desktop

**A11y:** `aria-label` on input, calendar: `role="grid"`, `aria-label` month/year, keyboard nav (arrows, Enter, Esc)

---

### 23. Empty State

**Anatomy:** Illustration (120px) → Title (heading) → Description (body) → Primary Action (Button)

**Variants:**
| Variant | Illustration | Title | Action |
|---------|--------------|-------|--------|
| **No Projects** | Clipboard + plus | "No projects yet" | "Create Project" |
| **Empty Board** | Kanban columns | "Board is empty" | "Create Task" |
| **No Results** | Search + slash | "No tasks match" | "Clear filters" |
| **No Members** | Users + plus | "No members" | "Invite Members" |

**A11y:** Illustration `aria-hidden`, descriptive text, action focusable

---

### 24. Skeleton

**Anatomy:** Shimmering rectangles matching component structure

**Variants:** Task Card, Project Card, Modal, Table Row, List Item

**Motion:** 1500ms linear shimmer loop (background-position), respects reduced-motion (static surfaceAlt)

**A11y:** `aria-busy="true"` on container, `aria-label="Loading..."`

---

## Component State Matrix (All Components × All States)

| Component | Default | Hover | Focus | Pressed | Disabled | Loading | Selected | Error | Empty |
|-----------|---------|-------|-------|---------|----------|---------|----------|-------|-------|
| Button | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | — |
| IconButton | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | — | — |
| Input | ✅ | ✅ | ✅ | — | ✅ | — | — | ✅ | — |
| Textarea | ✅ | ✅ | ✅ | — | ✅ | — | — | ✅ | — |
| Select | ✅ | ✅ | ✅ | — | ✅ | — | — | ✅ | — |
| Checkbox | ✅ | ✅ | ✅ | — | ✅ | — | ✅ | — | — |
| Radio | ✅ | ✅ | ✅ | — | ✅ | — | ✅ | — | — |
| Switch | ✅ | ✅ | ✅ | — | ✅ | — | ✅ | — | — |
| Card | ✅ | ✅ | ✅ | — | — | — | ✅ | — | ✅ |
| Table | ✅ | ✅ | ✅ | — | — | — | ✅ | — | ✅ |
| List | ✅ | ✅ | — | — | — | — | — | — | ✅ |
| Dialog | ✅ | — | ✅ | — | — | ✅ | — | ✅ | — |
| Drawer | ✅ | — | ✅ | — | — | — | — | — | — |
| Alert | ✅ | — | — | — | — | — | — | ✅ | — |
| Badge | ✅ | — | — | — | — | — | — | — | — |
| Tooltip | — | ✅ | ✅ | — | — | — | — | — | — |
| Breadcrumb | ✅ | ✅ | ✅ | — | — | — | ✅ | — | — |
| Pagination | ✅ | ✅ | ✅ | — | ✅ | — | ✅ | — | — |
| Avatar | ✅ | — | — | — | — | — | — | — | — |
| Dropdown | ✅ | ✅ | ✅ | — | — | — | — | — | — |
| Tabs | ✅ | ✅ | ✅ | — | ✅ | — | ✅ | — | — |
| DatePicker | ✅ | ✅ | ✅ | — | ✅ | — | — | ✅ | — |
| EmptyState | ✅ | — | — | — | — | — | — | — | ✅ |
| Skeleton | — | — | — | — | — | ✅ | — | — | — |

---

## Component Interaction Feedback Rules (Mandatory)

1. **Every interactive element** has: hover, focus (visible 2px ring), pressed (instant), disabled
2. **Destructive actions** require confirmation dialog (not inline)
3. **Async actions** (save, delete, move) show loading state on trigger, prevent double-submit
4. **Success feedback** — toast (2s auto-dismiss) or inline success banner
5. **Error feedback** — inline error + toast, retry affordance, preserve user input
6. **Validation** — inline on blur (field), on submit (form), `aria-invalid` + `aria-describedby`
7. **Drag feedback** — ghost card (opacity 0.8, rotate 2deg), drop zone highlight, insertion line
8. **Optimistic UI** — immediate visual update, revert on failure + toast
9. **Reduced motion** — all transitions 0ms, opacity cross-fade only, focus ring instant
10. **Touch targets** — minimum 44×44px on mobile (all interactive elements)

---

## Component Consistency Rules

| Rule | Enforcement |
|------|-------------|
| Single spacing scale | All gaps/padding from `--space-*` |
| Single radius scale | All radii from `--radius-*` |
| Single elevation scale | All shadows from `--elevation-*` |
| Single motion scale | All durations from `--motion-*`, easings from `--easing-*` |
| Single color palette | All colors from `--color-*` semantic tokens |
| Single type scale | All text from `--font-size-*`, `--font-weight-*`, `--line-height-*` |
| Focus ring | 2px solid `--color-focus`, offset 2px, on ALL interactive |
| Touch target | 44×44px minimum (enforced via min-height/min-width) |
| Reduced motion | `@media (prefers-reduced-motion)` zeros all durations |

---

## Component Dependencies (Build Order)

```
Base Tokens (color, typography, spacing, radius, elevation, layout, motion)
    ↓
Primitives: Button, Input, Checkbox, Radio, Switch, Avatar, Badge, Tooltip
    ↓
Composites: Card, Select, Textarea, IconButton, Dropdown, DatePicker
    ↓
Patterns: Table, List, Dialog, Drawer, Alert, Breadcrumb, Pagination, Tabs
    ↓
Page-Level: Board, Dashboard, Settings, Modals
```

---

## Component Quality Checklist (Per Component)

- [x] Anatomy documented
- [x] Variants defined with use cases
- [x] Sizes defined with use cases
- [x] All states specified (visual + motion)
- [x] A11y requirements complete (ARIA, keyboard, focus, contrast)
- [x] Content rules defined
- [x] Responsive behavior specified
- [x] Motion specified (duration, easing, properties)
- [x] Interaction feedback rules applied
- [x] Reduced-motion behavior defined
- [x] Dependencies mapped
- [x] No generic/template behavior — all project-specific