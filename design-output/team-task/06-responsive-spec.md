# TeamTask — Responsive Behavior Specification (Blueprint-First)

## Breakpoint System

| Breakpoint | Name | Min Width | Target Devices |
|------------|------|-----------|----------------|
| **xs** | Mobile Portrait | 320px | Small phones |
| **sm** | Mobile Landscape | 480px | Large phones |
| **md** | Tablet Portrait | 768px | iPad, tablets |
| **lg** | Tablet Landscape / Small Desktop | 1024px | iPad Pro, laptops |
| **xl** | Desktop | 1200px | Standard monitors |
| **xxl** | Large Desktop | 1440px+ | Wide monitors |

**CSS Implementation:**
```css
:root {
  --bp-xs: 320px;
  --bp-sm: 480px;
  --bp-md: 768px;
  --bp-lg: 1024px;
  --bp-xl: 1200px;
  --bp-xxl: 1440px;
}

/* Mobile-first approach */
@media (min-width: 480px) { /* sm */ }
@media (min-width: 768px) { /* md */ }
@media (min-width: 1024px) { /* lg */ }
@media (min-width: 1200px) { /* xl */ }
@media (min-width: 1440px) { /* xxl */ }
```

---

## Layout Response Per Page

### Dashboard (Project List)
| Breakpoint | Grid Columns | Container | Behavior |
|------------|--------------|-----------|----------|
| xs (320px) | 1 | 100vw - 32px | Single column, full-width cards |
| sm (480px) | 1 | 100vw - 32px | Single column |
| md (768px) | 2 | 1120px | 2-col grid, centered |
| lg (1024px) | 3 | 1120px | 3-col grid |
| xl (1200px) | 4 | 1120px | 4-col grid |
| xxl (1440px) | 5 | 1280px | 5-col grid, max-width |

**Gap:** 24px (desktop) / 16px (mobile)
**Card Min-Width:** 280px (prevents squishing)

---

### Kanban Board (Most Complex Responsive)

#### Desktop (≥1200px) — Full Board
```
┌────────────────────────────────────────────────────────────────────┐
│ Sticky Header (64px)                                               │
├────────────────────────────────────────────────────────────────────┤
│ Sticky Toolbar (56px)                                              │
├────────────────────────────────────────────────────────────────────┤
│ Board Scroll (horizontal)                                          │
│  Col1  Col2  Col3  Col4  Col5    ← 5 columns visible              │
│  280px each, gap 24px, horizontal scroll if >5 cols               │
└────────────────────────────────────────────────────────────────────┘
```

#### Tablet Landscape (1024–1199px) — 3 Cols + Scroll
```
│  Col1  Col2  Col3  [Col4→] [Col5→]  ← 3 visible, scroll for rest  │
```
- Touch-drag scroll on board container
- Scroll indicators (fade gradients) on edges

#### Tablet Portrait (768–1023px) — 2 Cols Stacked or Accordion
**Option A (default): 2-column grid**
```
│  Col1  Col2  │
│  Col3  Col4  │
│  Col5        │
```
- Vertical scroll for rows
- Column height matches content

**Option B: Accordion (user preference)**
- See Mobile section below

#### Mobile (480–767px) — Accordion Columns
```
┌────────────────────────────────────┐
│ Sticky Header (56px)               │
├────────────────────────────────────┤
│ Collapsible Toolbar (tap to expand)│
├────────────────────────────────────┤
│ ┌────────────────────────────────┐ │
│ │ ▼ BACKLOG (3)          [+]     │ │  ← Tap to expand
│ └────────────────────────────────┘ │
│ ┌────────────────────────────────┐ │
│ │ ▶ TO DO (5)              [+]   │ │  ← Collapsed
│ └────────────────────────────────┘ │
│ ┌────────────────────────────────┐ │
│ │ ▶ IN PROGRESS (2)        [+]   │ │
│ └────────────────────────────────┘ │
│ ┌────────────────────────────────┐ │
│ │ ▶ IN REVIEW (1)          [+]   │ │
│ └────────────────────────────────┘ │
│ ┌────────────────────────────────┐ │
│ │ ▶ DONE (8)               [+]   │ │
│ └────────────────────────────────┘ │
├────────────────────────────────────┤
│ FAB: [+ Create Task] (fixed)       │
└────────────────────────────────────┘
```

**Accordion Behavior:**
- Default: First column (Backlog) expanded, others collapsed
- Tap header → smooth height transition (220ms, easing enter/exit)
- Only one expanded at a time (accordion) — configurable to multi-expand
- Swipe left/right on expanded column to navigate (optional)
- Column header always shows: Name, count, WIP badge, [+] button

#### Mobile Small (<480px) — Single Column View
- Only one column visible at a time
- Bottom tab bar (5 tabs) to switch columns
- FAB for create
- Task detail = full-screen drawer

---

### Task Detail Modal / Drawer
| Breakpoint | Pattern | Width | Motion |
|------------|---------|-------|--------|
| ≥768px | Modal (centered) | 560px max | Slide up + fade (220ms) |
| <768px | Bottom Sheet Drawer | 100vw | Slide up (220ms), swipe dismiss |

**Drawer Details (Mobile):**
- Handle bar at top (tap/drag to dismiss)
- Drag down 50px → dismiss (with spring)
- Backdrop tap → dismiss
- Esc key → dismiss
- Restore focus to trigger on close

---

### Create Task Modal
| Breakpoint | Pattern |
|------------|---------|
| ≥768px | Modal (560px) |
| <768px | Bottom Sheet Drawer (same as task detail) |

---

### Project Settings
| Breakpoint | Layout |
|------------|--------|
| ≥1024px | Tabs horizontal, content side-by-side (tabs 240px, content 1fr) |
| 768–1023px | Tabs horizontal scrollable, content full-width below |
| <768px | Tabs → Accordion sections (tap to expand) |

---

## Component Responsive Behavior

### Button
| Breakpoint | Behavior |
|------------|----------|
| All | Full-width on mobile when in stacked form |
| xs/sm | Minimum 44px height, full-width in forms |

### Input / Select / Textarea
| Breakpoint | Behavior |
|------------|----------|
| All | Full-width in forms |
| xs/sm | Native date picker on mobile, custom on desktop |

### Card (Task)
| Breakpoint | Behavior |
|------------|----------|
| Desktop | Fixed width per column (280px), variable height |
| Tablet | Same |
| Mobile Accordion | Full column width, max-height per card (clamp description) |
| Mobile Single | Full viewport width |

### Table (Activity Log, Members)
| Breakpoint | Behavior |
|------------|----------|
| ≥768px | Full table, horizontal scroll if needed |
| <768px | Card layout: each row → stacked card with label:value pairs |

**Table → Card Transformation:**
```
Desktop: | Timestamp | Action | Actor | Details |
Mobile:  ┌─────────────────────────┐
         │ 2h ago    Move          │
         │ Actor: John Doe         │
         │ Details: To Do → In Prog│
         └─────────────────────────┘
```

### List (Comments)
| Breakpoint | Behavior |
|------------|----------|
| All | Same layout, compressed padding on mobile |

### Modal / Dialog
| Breakpoint | Width | Max Height |
|------------|-------|------------|
| ≥768px | 560px | 90vh |
| <768px | 100vw (drawer) | 100vh |

### Tooltip
| Breakpoint | Behavior |
|------------|----------|
| ≥768px | Hover + Focus |
| <768px | Focus only (hover not reliable), tap to show (2s auto-dismiss) |

### Dropdown Menu
| Breakpoint | Positioning |
|------------|-------------|
| ≥768px | Anchor to trigger, auto-flip |
| <768px | Bottom sheet (full-width) |

### FAB (Mobile Only)
| Breakpoint | Position |
|------------|----------|
| <768px | Fixed bottom-right (24px), 56×56px |
| ≥768px | Hidden (use toolbar/button) |

---

## Density Modes (User Preference)

| Mode | Spacing Multiplier | Card Padding | Font Size | Use Case |
|------|-------------------|--------------|-----------|----------|
| **Compact** | 0.75× | 12px | 0.875rem | Power users, many tasks |
| **Comfortable** | 1.0× (default) | 16px | 1rem | Default |
| **Relaxed** | 1.25× | 20px | 1.125rem | Accessibility, large screens |

**Implementation:**
```css
html[data-density="compact"] {
  --space-unit: 3px;
  --space-control-gap: 9px;
  --space-component-gap: 12px;
  --space-section-gap: 36px;
  --font-size-body: 0.875rem;
  --radius-control: 6px;
  --radius-card: 9px;
}

html[data-density="relaxed"] {
  --space-unit: 5px;
  --space-control-gap: 15px;
  --space-component-gap: 20px;
  --space-section-gap: 60px;
  --font-size-body: 1.125rem;
  --radius-control: 10px;
  --radius-card: 15px;
}
```

**Persistence:** `localStorage.setItem('density', mode)` + apply on `<html>` load

---

## Touch & Pointer Adaptations

### Touch Targets (All Breakpoints)
| Element | Minimum | Implementation |
|---------|---------|----------------|
| Buttons | 44×44px | `min-height: 44px; min-width: 44px;` |
| IconButtons | 44×44px | Padding + `touch-action: manipulation` |
| Checkbox/Radio/Switch | 44×44px hit area | `::before` pseudo hit area |
| Links | 44×44px | `display: inline-flex; align-items: center; min-height: 44px;` |
| Table rows (mobile card) | 44px height | `min-height: 44px` |
| Drag handle | 44×44px | Visible grip + invisible hit area |

### Hover States (Pointer vs Touch)
```css
@media (hover: hover) and (pointer: fine) {
  /* Hover styles only for mouse/trackpad */
  .btn:hover { ... }
  .card:hover { ... }
}

@media (hover: none) and (pointer: coarse) {
  /* Touch: no hover, active states prominent */
  .btn:active { ... }
  .card:active { ... }
}
```

### Drag & Drop
| Device | Initiation | Feedback |
|--------|------------|----------|
| Mouse | Click drag handle, drag | Ghost card, drop zones highlight |
| Touch | Long press (300ms) on drag handle | Vibration, ghost card, drop zones highlight |
| Keyboard | Space on drag handle → Arrow keys → Enter to drop | Focus ring, live region announcements |

---

## Viewport Meta & CSS Reset
```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
```

```css
*, *::before, *::after {
  box-sizing: border-box;
}

html {
  -webkit-text-size-adjust: 100%;
  -webkit-tap-highlight-color: transparent;
}

body {
  margin: 0;
  font-family: var(--font-family);
  font-size: var(--font-size-body);
  line-height: var(--line-height-body);
  color: var(--color-text);
  background: var(--color-surface);
}
```

---

## Container Queries (Future-Proofing)
For component-level responsiveness (e.g., Task Card in different containers):
```css
.task-card {
  container-type: inline-size;
}

@container (max-width: 300px) {
  .task-card .description { display: none; }
  .task-card .metadata { flex-wrap: wrap; gap: 8px; }
}

@container (min-width: 400px) {
  .task-card .metadata { flex-direction: row; }
}
```

---

## Responsive Testing Checklist

| Test | Breakpoints | Devices |
|------|-------------|---------|
| Layout integrity | All 6 | Chrome DevTools device toolbar |
| Touch targets | xs, sm | Real phone (iOS Safari, Chrome Android) |
| Drag & drop | All | Mouse, touch, keyboard |
| Modal/Drawer | xs, sm, md, lg | All |
| Text readability | All | Zoom 100%, 150%, 200% |
| Horizontal scroll | None unintended | All |
| Focus visibility | All | Tab navigation |
| Performance | All | Lighthouse, 60fps animations |

---

## Responsive Quality Gates (Machine-Evaluable)

| Gate | Criteria | Measurement |
|------|----------|-------------|
| **No horizontal scroll** | Body width ≤ viewport at all breakpoints | `document.body.scrollWidth <= window.innerWidth` |
| **Touch targets** | All interactive ≥ 44×44px | Automated aXe + manual |
| **Text readability** | No text < 12px (0.75rem) at default zoom | `getComputedStyle(el).fontSize >= '12px'` |
| **Focus visibility** | 2px ring on all interactive | `:focus-visible` styles present |
| **Content reflow** | No overlap/clipping at any breakpoint | Visual regression |
| **Motion respect** | `prefers-reduced-motion` zeros durations | CSS media query verified |
| **Density persistence** | Preference survives reload | localStorage + HTML attribute |