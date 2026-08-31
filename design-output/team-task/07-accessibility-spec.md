# TeamTask — Accessibility Specification (Blueprint-First, WCAG 2.1 AA)

## Conformance Target

**WCAG 2.1 Level AA** — All criteria met for all pages, components, and states.

---

## Per-Criterion Implementation

### 1.1.1 Non-text Content (A)
| Element | Implementation |
|---------|----------------|
| **Icons** | Decorative: `aria-hidden="true"`; Meaningful: `aria-label` or adjacent text; Icon-only buttons: `aria-label` + tooltip |
| **Illustrations (empty states)** | `aria-hidden="true"` + descriptive text sibling |
| **Avatars** | `alt=""` for decorative; `alt="Name"` for meaningful; `role="img"` |
| **Charts/Graphs** | Not in scope (no analytics) |
| **CAPTCHA** | Not used |

### 1.3.1 Info and Relationships (A)
| Structure | Implementation |
|-----------|----------------|
| **Headings** | `<h1>` page title, `<h2>` sections, `<h3>` subsections — logical hierarchy |
| **Lists** | `<ul>`/`<ol>` for comments, activities, members; `<dl>` for metadata |
| **Forms** | `<label for=id>`, `<fieldset>`/`<legend>` for groups (radio, checkbox), `aria-describedby` for helper/error |
| **Tables** | `<caption>`, `<th scope="col|row">`, `<thead>`/`<tbody>` |
| **Landmarks** | `<header>`, `<main>`, `<nav>`, `<aside>`, `<footer>`, `<section aria-labelledby>` |

### 1.3.2 Meaningful Sequence (A)
- DOM order matches visual reading order (top-to-bottom, left-to-right)
- Modal focus trap maintains sequence
- Drawer content follows header→body→footer

### 1.3.3 Sensory Characteristics (A)
- No instructions rely solely on shape, color, size, visual location, orientation, or sound
- "Click the blue button" → "Click the Create Task button"
- "Drag to the right column" → "Drag to the In Progress column"

### 1.4.1 Use of Color (A)
- **Color never sole conveyor of meaning**
- Task status: color + text badge ("Overdue", "Due Today")
- Priority: color + icon + text
- Links: underline + color (not color alone)
- Focus: ring + color
- Error: icon + text + color

### 1.4.3 Contrast (Minimum) (AA) — **Validated Per Token**

| Pair | Ratio | Requirement | Status |
|------|-------|-------------|--------|
| Text (body) on Surface | 12.8:1 | 4.5:1 | ✅ |
| Muted Text on Surface | 6.2:1 | 4.5:1 | ✅ |
| Primary on White | 4.8:1 | 4.5:1 | ✅ |
| White on Primary | 4.8:1 | 4.5:1 | ✅ |
| Danger on White | 5.1:1 | 4.5:1 | ✅ |
| White on Danger | 5.1:1 | 4.5:1 | ✅ |
| Warning on White | 4.6:1 | 4.5:1 | ✅ |
| Success on White | 5.3:1 | 4.5:1 | ✅ |
| Border on Surface | 3.1:1 | 3:1 (UI) | ✅ |
| Focus Ring on Surface | 3.2:1 | 3:1 (UI) | ✅ |
| Disabled Text on Surface | 3.8:1 | — (exempt) | N/A |
| Placeholder Text | 4.5:1 | 4.5:1 | ✅ |

**Validation Tool:** Automated in CI (axe-core + custom token contrast audit)

### 1.4.4 Resize Text (AA)
- Base font: 16px (user agent default)
- Zoom 200%: No horizontal scroll, no content loss
- Relative units (rem) throughout
- Container queries for component adaptation

### 1.4.5 Images of Text (AA)
- No images of text (all text is real text)
- Logo: SVG with text fallback

### 1.4.10 Reflow (AA)
- 320px CSS pixels: Single column, no horizontal scroll
- 256px: Functional (min supported)
- Verified at all breakpoints

### 1.4.11 Non-text Contrast (AA)
| UI Component | Contrast | Status |
|--------------|----------|--------|
| Button borders | 3.1:1 | ✅ |
| Input borders | 3.1:1 | ✅ |
| Focus rings | 3.2:1 | ✅ |
| Checkbox/radio borders | 3.1:1 | ✅ |
| Switch track | 3.1:1 | ✅ |
| Slider thumb | 3.1:1 | N/A (no slider) |
| Tooltip bg | 7:1 | ✅ |
| Modal backdrop | N/A (overlay) | — |

### 1.4.12 Text Spacing (AA)
```css
/* User stylesheet override supported */
html {
  line-height: 1.5 !important;
  letter-spacing: 0.12em !important;
  word-spacing: 0.16em !important;
}
```
- No loss of content/function at increased spacing
- Containers use `min-height`, not fixed height

### 1.4.13 Content on Hover/Focus (AA)
- Tooltips: dismissible (Esc), hoverable (move cursor into), persistent (300ms delay)
- Dropdowns: hover/focus trigger, focus trap, Esc dismiss
- No content only on hover without focus equivalent

---

## 2.1.1 Keyboard (A) — **Full Keyboard Operability**

### Global Keyboard Map
| Key | Context | Action |
|-----|---------|--------|
| `Tab` / `Shift+Tab` | Global | Next/previous focusable |
| `Enter` / `Space` | Buttons, links, checkboxes, radios | Activate |
| `Esc` | Modals, drawers, dropdowns, toasts | Close/dismiss |
| `Arrow Keys` | Menus, tabs, radio groups, date picker, board navigation | Navigate options |
| `Home` / `End` | Menus, tabs, lists | First/last |
| `Page Up/Down` | Long lists | Scroll by page |
| `Space` (on drag handle) | Board | Pick up task for keyboard drag |
| `Arrow Keys` (drag mode) | Board | Move between columns/cards |
| `Enter` (drag mode) | Board | Drop task |
| `Esc` (drag mode) | Board | Cancel drag |

### Board Keyboard Navigation (Critical)
```
Tab sequence:
1. Project header (back link, title, settings)
2. Toolbar (search, filters, density, view)
3. Column 1 header → cards (vertical) → column 2 header → cards → ...
4. FAB (mobile)

Within column:
- Arrow Up/Down: Move between cards
- Enter: Open task detail
- Space: Pick up for drag → Arrow keys navigate → Enter drop → Esc cancel
- Live region announces: "Picked up Task Title, moved to In Progress, dropped"
```

### Focus Management
| Scenario | Behavior |
|----------|----------|
| Modal open | Focus first focusable (title input), trap, restore on close |
| Drawer open | Focus first focusable, trap, restore on close |
| Dropdown open | Focus first item, arrow nav, Esc closes, restore trigger |
| Page navigation | Focus `<main>` or first heading |
| Drag start | Announce "Drag started", live region updates |
| Drag drop | Announce "Dropped in [Column]", focus stays on card |
| Task delete | Focus next card or column header |
| Filter change | Announce "X tasks filtered", focus stays |

### Visible Focus Indicator (Mandatory)
```css
:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
  border-radius: var(--radius-control);
}

/* High contrast mode support */
@media (forced-colors: active) {
  :focus-visible {
    outline: 2px solid CanvasText;
    outline-offset: 2px;
  }
}
```
- **Never** `outline: none` without replacement
- **Always** 2px minimum, offset 2px, `--color-focus` (validated 3:1)

---

## 2.1.2 No Keyboard Trap (A)
- All modals/drawers/dropdowns: Esc closes, focus returns to trigger
- Board drag mode: Esc cancels, focus stays on card
- No infinite focus loops

### 2.1.4 Character Key Shortcuts (A)
- No single-character shortcuts (all require modifier or are in input)
- `?` for help (if implemented) — only when not in input

---

## 2.2.1 Timing Adjustable (A)
- No time limits on user actions
- Toast auto-dismiss: 2s minimum, user can extend via hover/focus
- No auto-advancing carousels

### 2.2.2 Pause, Stop, Hide (A)
- Skeleton shimmer: pauses on hover/focus, respects `prefers-reduced-motion`
- No auto-playing video/audio

---

## 2.3.1 Three Flashes (A)
- No flashing content
- Animations: opacity/transform only, ≤3Hz

### 2.3.3 Animation from Interactions (AAA — implemented)
- `prefers-reduced-motion: reduce` → all durations 0ms, opacity cross-fade only
- Essential feedback (focus, loading) retained non-animated

---

## 2.4.1 Bypass Blocks (A)
- Skip link: `<a href="#main" class="skip-link">Skip to main content</a>` (first focusable)
- Visible on focus: `position: fixed; top: -100%; left: 50%; transform: translateX(-50%);`
- On focus: `top: var(--space-4); z-index: 9999;`

### 2.4.2 Page Titled (A)
- `<title>Project Name — TeamTask</title>` dynamic per page
- Modal: `<title>` unchanged, `aria-labelledby` on dialog

### 2.4.3 Focus Order (A)
- DOM order = visual order
- Modal: header → body → footer
- Board: header → toolbar → columns (left-to-right) → cards (top-to-bottom)

### 2.4.4 Link Purpose (In Context) (A)
- All links: descriptive text ("Create Project", not "Click here")
- Icon-only links: `aria-label`
- Breadcrumb: `aria-label="Breadcrumb"`, `aria-current="page"`

### 2.4.5 Multiple Ways (AA)
- Board accessible via: Project card click, direct URL, browser history
- Task detail: Card click, URL, keyboard (Enter on card)

### 2.4.6 Headings and Labels (AA)
- Unique, descriptive headings per section
- Labels: visible or `aria-label`/`aria-labelledby`

### 2.4.7 Focus Visible (AA)
- **Always visible** — `:focus-visible` on all interactive
- Never hidden by `overflow: hidden` or `z-index`

---

## 3.1.1 Language of Page (A)
- `<html lang="en">` (configurable per user/org)

### 3.1.2 Language of Parts (AA)
- No multi-language content currently
- Comments: `lang` attribute if detected

---

## 3.2.1 On Focus (A)
- No unexpected context change on focus
- Focus ≠ activation (except native `<select>`)

### 3.2.2 On Input (A)
- No unexpected context change on input
- Autosave on blur (not on input)
- Filter: debounced, no navigation

### 3.2.3 Consistent Navigation (AA)
- Global nav: same order, same position
- Breadcrumbs: same pattern
- User menu: same location

### 3.2.4 Consistent Identification (AA)
- Same component = same label/behavior
- "Create Task" button always "Create Task"
- Icons consistent meaning (plus = create, trash = delete)

---

## 3.3.1 Error Identification (A)
- Errors: text + icon + color
- `aria-invalid="true"` + `aria-describedby="error-id"`
- Error summary at top of form/modal

### 3.3.2 Labels or Instructions (A)
- All inputs: visible `<label>` or `aria-label`
- Required: `required` attribute + "*" in label
- Helper text: `aria-describedby`
- Placeholder: never sole label

### 3.3.3 Error Suggestion (AA)
- Errors state problem + suggestion
- "Title is required" (not "Invalid input")
- "Due date must be in the future" (not "Invalid date")

### 3.3.4 Error Prevention (AA) — Legal/Financial/Data
- Destructive actions: confirmation dialog (type name for delete project)
- No legal/financial transactions in scope
- Data deletion: double confirmation

---

## 4.1.1 Parsing (A)
- Valid HTML5, unique IDs, proper nesting
- Validated in CI (html-validate)

### 4.1.2 Name, Role, Value (A)
| Component | Role | Name | Value |
|-----------|------|------|-------|
| Button | `button` | Visible text / `aria-label` | — |
| Checkbox | `checkbox` | Label | `aria-checked` |
| Radio | `radio` | Label | `aria-checked` |
| Switch | `switch` | Label | `aria-checked` |
| Select | `combobox`/`select` | Label | `aria-expanded`, selected option |
| Dialog | `dialog` | `aria-labelledby` | `aria-modal="true"` |
| Menu | `menu` | `aria-label` | — |
| Menuitem | `menuitem` | Text | `aria-disabled` |
| Tab | `tab` | Text | `aria-selected` |
| Tabpanel | `tabpanel` | `aria-labelledby` | — |
| Table | `table` | `<caption>` | — |
| Row | `row` | — | `aria-selected` |
| Cell | `cell`/`gridcell` | — | — |
| Progress | `progressbar` | `aria-label` | `aria-valuenow` |
| Toast | `alert`/`status` | Text | — |

### 4.1.3 Status Messages (AA)
| Message | Role | Live Region |
|---------|------|-------------|
| Toast (success/info) | `status` | `aria-live="polite"` |
| Error toast | `alert` | `aria-live="assertive"` |
| Filter results | `status` | `aria-live="polite"` |
| Drag announcements | `status` | `aria-live="polite"` |
| Autosave status | `status` | `aria-live="polite"` |
| Validation error | `alert` | `aria-live="assertive"` |

---

## Component-Specific A11y Requirements

### Kanban Board
- **Landmarks:** `<header>` (project), `<nav>` (toolbar), `<main>` (board), `<section aria-labelledby="col-1">` per column
- **Columns:** `<section aria-labelledby="col-1-heading">`, heading = column name + count
- **Cards:** `<article role="listitem" aria-label="Task Title, In Progress, 3 points, due tomorrow">`
- **Drag:** `aria-grabbed`, `aria-dropeffect`, live region for announcements
- **Keyboard drag:** Space to grab → Arrows → Enter drop → Esc cancel

### Task Card
- Focusable (`tabindex="0"`), `role="article"`
- `aria-label`: "Task Title, [Column], [Points] points, [Due status], [Assignee]"
- Click/Enter → open detail
- Space → keyboard drag mode
- Drag handle: `tabindex="0"`, `role="button"`, `aria-label="Drag Task Title"`

### Modal (Task Detail, Create, Confirm)
- `role="dialog" aria-modal="true" aria-labelledby="modal-title"`
- Focus trap (Tab cycles within, Shift+Tab reverse)
- Initial focus: first input (title) or close button (confirm)
- Restore focus to trigger on close
- Esc → close (except confirm delete)
- Backdrop click → close (except confirm delete)

### Form Fields
```html
<label for="task-title">Title <span class="required" aria-hidden="true">*</span></label>
<input id="task-title" name="title" required aria-describedby="title-hint title-error">
<span id="title-hint">Brief, descriptive title</span>
<span id="title-error" role="alert" aria-live="polite">Title is required</span>
```

### Dropdown Menu
- Trigger: `aria-haspopup="menu" aria-expanded="false"`
- Panel: `role="menu"`, items `role="menuitem"`
- Keyboard: Arrow Up/Down, Home/End, Enter/Space activate, Esc close
- Focus trap within panel

### Tabs
- `role="tablist"`, tabs `role="tab"`, panels `role="tabpanel"`
- `aria-selected`, `aria-controls`, `id`/`aria-labelledby`
- Arrow keys navigate, Home/End, Enter/Space activate (auto or manual)

### Date Picker
- Input: `aria-label="Due date"`, `readonly`
- Popover: `role="dialog" aria-label="Choose due date"`
- Grid: `role="grid"`, days `role="gridcell"`, today `aria-current="date"`
- Keyboard: Arrow keys navigate, Enter select, Esc close

### Avatar Stack
- `role="group" aria-label="5 members"`
- Each: `role="img" aria-label="Name"` or `alt=""`
- Overflow: `aria-label="3 more members"`

### Toast/Alert
- Success/Info: `role="status" aria-live="polite"`
- Warning/Error: `role="alert" aria-live="assertive"`
- Dismissible: button with `aria-label="Dismiss"`
- Auto-dismiss: 5s minimum, pause on hover/focus

---

## Screen Reader Testing Scenarios

| Scenario | Expected Announcement |
|----------|----------------------|
| Page load (board) | "Projects, TeamTask Board, main landmark" |
| Focus column header | "Backlog, heading level 2, 3 tasks" |
| Focus task card | "Fix login bug, In Progress, 3 points, due tomorrow, assignee John" |
| Press Space on card | "Drag started, Fix login bug picked up" |
| Arrow Right (drag mode) | "Moved to In Progress" |
| Enter (drop) | "Dropped in In Progress" |
| Open task detail | "Dialog, Fix login bug, edit text, Title" |
| Add comment | "Comment added, Fix login bug" |
| Filter by assignee | "Filtered by John Doe, 2 tasks" |
| Error on save | "Alert, Failed to save, Title is required" |

---

## Automated Testing (CI)
```yaml
# .github/workflows/a11y.yml
- axe-core: full page scan (all pages, all states)
- html-validate: parsing, structure
- custom: token contrast audit (all pairs)
- custom: focus-visible presence
- custom: aria attribute validity
- lighthouse: a11y score ≥ 95
```

---

## Manual Testing Matrix

| Assistive Tech | Browser | OS | Status |
|----------------|---------|-----|--------|
| NVDA | Firefox | Windows | Required |
| JAWS | Chrome | Windows | Required |
| VoiceOver | Safari | macOS | Required |
| VoiceOver | Safari | iOS | Required |
| TalkBack | Chrome | Android | Required |
| Dragon | Chrome | Windows | Optional |
| ZoomText | Chrome | Windows | Optional |

---

## Accessibility Debt (Known, Tracked)
1. **Drag & drop** — Keyboard alternative exists but not as efficient; monitor user feedback
2. **Date picker** — Native on mobile, custom on desktop; ensure parity
3. **Activity log table** — Mobile card view loses column headers; `data-label` attributes added
4. **Toast stacking** — Multiple toasts may stack; limit to 3, queue others

---

## Accessibility Checklist (Per Release)

- [ ] axe-core: 0 violations (AA)
- [ ] html-validate: 0 errors
- [ ] Token contrast: all pairs pass
- [ ] Focus-visible: all interactive elements
- [ ] Keyboard: full task lifecycle (create → move → edit → delete)
- [ ] Screen reader: NVDA + VoiceOver critical paths
- [ ] Zoom 200%: no horizontal scroll, no content loss
- [ ] Reduced motion: all animations disabled, focus retained
- [ ] High contrast: forced-colors mode functional
- [ ] Touch targets: 44×44px minimum
- [ ] Language: `lang` attribute correct
- [ ] Skip link: functional
- [ ] Error handling: identified, described, suggested
- [ ] Status messages: live regions correct