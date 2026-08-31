# TeamTask — Motion & Interaction Feedback Specification (Blueprint-First)

## Motion Principles (Derived from Visual Identity: Clarity, Balanced Energy)

| Principle | Application |
|-----------|-------------|
| **Purposeful** | Every animation communicates state change, not decoration |
| **Performant** | Transform/opacity only, GPU-accelerated, 60fps |
| **Respectful** | `prefers-reduced-motion` honored completely |
| **Fast** | Max 360ms, most ≤220ms |
| **Consistent** | Same duration/easing for same-type transitions |
| **Interruptible** | New state cancels previous animation cleanly |

---

## Motion Token Reference (from Design Tokens)

| Token | Duration | Easing | Curve |
|-------|----------|--------|-------|
| **quick** | 150ms | standard | `cubic-bezier(0.2, 0, 0, 1)` |
| **standard** | 220ms | enter | `cubic-bezier(0.16, 1, 0.3, 1)` |
| **slow** | 360ms | exit | `cubic-bezier(0.4, 0, 1, 1)` |
| **enter** | 220ms | enter | `cubic-bezier(0.16, 1, 0.3, 1)` |
| **exit** | 150ms | exit | `cubic-bezier(0.4, 0, 1, 1)` |

**Reduced Motion:** All durations → 0ms (opacity cross-fade only), no transform/scale/parallax. Essential feedback (focus ring, loading spinner) retained instant.

---

## Interaction Feedback Map (Every Interactive Element)

### Buttons (All Variants)
| Trigger | Properties | Duration | Easing |
|---------|------------|----------|--------|
| Hover | `background-color`, `border-color`, `box-shadow` | 150ms | standard |
| Focus | `box-shadow` (ring) | 150ms | standard |
| Press (mouse) | `transform: scale(0.98)` | 0ms (instant) | — |
| Press (touch) | `transform: scale(0.96)` | 0ms | — |
| Loading | Spinner fade-in, label fade-out, width lock | 150ms | standard |
| Success | `background-color` → success, icon swap | 150ms | standard |
| Disabled | Opacity 0.5, cursor not-allowed | 0ms | — |

### IconButton
| Trigger | Properties | Duration | Easing |
|---------|------------|----------|--------|
| Hover | `background-color` (surfaceAlt), `color` (primary) | 150ms | standard |
| Focus | Ring | 150ms | standard |
| Press | `transform: scale(0.9)` | 0ms | — |
| Selected | `background-color` (primary), `color` (white) | 150ms | standard |

### Input / Select / Textarea
| Trigger | Properties | Duration | Easing |
|---------|------------|----------|--------|
| Hover | `border-color` (darker 10%) | 150ms | standard |
| Focus | `box-shadow` (ring), `border-color` (primary) | 150ms | standard |
| Error | `border-color` (danger), shake (optional) | 150ms | standard |
| Valid | Success icon fade-in (trailing) | 150ms | standard |

### Checkbox / Radio / Switch
| Trigger | Properties | Duration | Easing |
|---------|------------|----------|--------|
| Hover | `border-color` (primary), `background` (primary 10%) | 150ms | standard |
| Focus | Ring | 150ms | standard |
| Check/Uncheck | `background-color`, check glyph scale (0→1) | 150ms | enter |
| Indeterminate | Minus glyph fade | 150ms | standard |
| Switch toggle | Thumb `translateX`, track `background-color` | 220ms | enter |

### Card (Task, Project)
| Trigger | Properties | Duration | Easing |
|---------|------------|----------|--------|
| Hover | `transform: translateY(-2px)`, `box-shadow` (elevation 1→2) | 220ms | enter |
| Focus | Ring | 150ms | standard |
| Drag Start | `opacity: 0.8`, `transform: rotate(2deg)`, elevation 3 | 0ms | — |
| Drop | Snap to position (FLIP), elevation 1→2→1 | 220ms | standard |
| Reorder | FLIP animation between positions | 220ms | standard |

### Modal / Dialog / Drawer
| Trigger | Properties | Duration | Easing |
|---------|------------|----------|--------|
| Open | `opacity: 0→1`, `transform: translateY(10px) scale(0.95) → 0 scale(1)`, backdrop `opacity: 0→0.4` | 220ms | enter |
| Close | `opacity: 1→0`, `transform: scale(1) → scale(0.95) translateY(10px)`, backdrop `opacity: 0.4→0` | 150ms | exit |
| Focus Trap | Instant (no animation) | — | — |

### Toast / Alert
| Trigger | Properties | Duration | Easing |
|---------|------------|----------|--------|
| Appear | `opacity: 0→1`, `transform: translateY(20px) → 0` | 150ms | enter |
| Dismiss (user) | `opacity: 1→0`, `transform: translateX(100%)` | 150ms | exit |
| Auto-dismiss | Same as dismiss | 150ms | exit |
| Pause on hover | Pause timer, no animation | — | — |

### Tooltip
| Trigger | Properties | Duration | Easing |
|---------|------------|----------|--------|
| Show (hover/focus) | `opacity: 0→1`, `transform: translateY(-4px) → 0` | 150ms | standard |
| Hide | `opacity: 1→0`, `transform: translateY(0 → -4px)` | 150ms | standard |
| Delay | 300ms (hover), 0ms (focus) | — | — |

### Dropdown Menu
| Trigger | Properties | Duration | Easing |
|---------|------------|----------|--------|
| Open | `opacity: 0→1`, `transform: scale(0.95) → 1` | 150ms | enter |
| Close | `opacity: 1→0`, `transform: scale(1) → scale(0.95)` | 150ms | exit |

### Tabs
| Trigger | Properties | Duration | Easing |
|---------|------------|----------|--------|
| Switch | Panel cross-fade `opacity`, indicator `transform: translateX` | 150ms | standard |

### Table / List Row
| Trigger | Properties | Duration | Easing |
|---------|------------|----------|--------|
| Hover | `background-color` (surfaceAlt) | 150ms | standard |
| Select | `background-color` (selected), `color` (selectedText) | 150ms | standard |

### Skeleton Shimmer
| Property | Value |
|----------|-------|
| Duration | 1500ms (loop) |
| Easing | linear |
| Keyframes | `background-position: -200% → 200%` |
| Reduced Motion | Static `surfaceAlt` (no animation) |

### Spinner (Loading)
| Property | Value |
|----------|-------|
| Duration | 600ms (loop) |
| Easing | linear |
| Keyframes | `transform: rotate(0deg) → rotate(360deg)` |
| Size | 20px (inline), 32px (overlay) |
| Color | `currentColor` (inherits primary on primary buttons) |

### Drag & Drop (Board)
| Phase | Properties | Duration | Easing |
|-------|------------|----------|--------|
| Pickup (mouse) | Ghost: `opacity 0.8`, `rotate(2deg)`, `box-shadow` elevation 3 | 0ms | — |
| Pickup (touch) | Same + vibration (50ms) | 0ms | — |
| Drag Over | Drop zone: `background-color` pulse (primary 10%) | 150ms | standard |
| Drop Zone Active | Column header: `box-shadow` inset pulse | 150ms | standard |
| Insertion Line | `height: 0 → 2px`, `background: primary` | 150ms | standard |
| Reorder (FLIP) | Card `transform` between positions | 220ms | standard |
| Drop Success | Ghost → target position (FLIP), card settle | 220ms | standard |
| Drop Fail | Ghost snap back to origin (spring) | 300ms | `cubic-bezier(0.16, 1, 0.3, 1)` |
| Keyboard Drag | Live region announcements (no visual ghost) | — | — |

### Page Transitions
| Transition | Properties | Duration | Easing |
|------------|------------|----------|--------|
| Board → Task Detail | Modal slide up (as Modal Open) | 220ms | enter |
| Task Detail → Board | Modal slide down (as Modal Close) | 150ms | exit |
| Board → Settings | Page cross-fade (if SPA) | 150ms | standard |
| Dashboard → Board | Page slide (if SPA) | 220ms | enter |

---

## State Transition Diagrams (Critical Flows)

### Task Creation Flow
```
Idle → Click Create → Modal Open (220ms enter)
    → Focus Title → Type → Tab to fields → Fill → Click Create
    → Button Loading (spinner 150ms) → API Call
    → Success: Toast Appear (150ms) → Modal Close (150ms exit)
    → Card Appear in Column (220ms enter + FLIP)
    → Error: Inline Alert (150ms) + Toast (150ms) → Button Reset
```

### Task Drag & Drop (Mouse)
```
Idle → Click Drag Handle → Ghost Appears (0ms)
    → Drag → Drop Zones Highlight (150ms pulse)
    → Drop Valid → Card FLIP to Position (220ms)
    → Toast "Moved to [Column]" (150ms appear → 2s → 150ms dismiss)
    → Drop Invalid → Ghost Snap Back (300ms spring) → Toast "Can't move there"
```

### Task Drag & Drop (Touch)
```
Idle → Long Press (300ms) → Vibration → Ghost Appears
    → Drag → Same as mouse
    → Drop → Same
```

### Task Drag & Drop (Keyboard)
```
Focus Card → Space → "Drag started, Task Title picked up" (live region)
    → Arrow Right → "Moved to In Progress" (live region)
    → Arrow Right → "Moved to In Review" (live region)
    → Enter → "Dropped in In Review" (live region) → Toast
    → Esc → "Drag cancelled" (live region) → Focus Restored
```

### Task Edit (Modal)
```
Click Card → Modal Open (220ms) → Focus Title
    → Edit Fields → Autosave on Blur (500ms debounce)
    → Save Button: Dirty dot → Click → Loading (150ms) → Success
    → Toast "Saved" → Modal Close (150ms)
    → Card Update (FLIP if position changed)
```

### Delete Task (Admin)
```
Click ⋮ → Delete → Confirm Modal (150ms) → Type Name → Click Delete
    → Button Loading → API → Success
    → Toast "Task deleted" + Undo (3s) → Card Remove (150ms exit)
    → Undo Clicked → Card Restore (220ms enter)
```

---

## Reduced Motion Behavior (Complete)

### CSS Implementation
```css
@media (prefers-reduced-motion: reduce) {
  :root {
    --motion-quick: 0ms;
    --motion-standard: 0ms;
    --motion-slow: 0ms;
  }

  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }

  /* Exceptions: keep essential feedback instant */
  :focus-visible {
    transition-duration: 0ms !important;
  }

  .spinner,
  .skeleton {
    animation: none !important;
  }

  .skeleton {
    background: var(--color-surface-alt);
  }
}
```

### What Stays (Essential Feedback)
| Feedback | Behavior in Reduced Motion |
|----------|---------------------------|
| Focus ring | Instant (0ms transition) |
| Loading spinner | Static (or single frame) |
| Skeleton | Static `surfaceAlt` |
| Toast appear/dismiss | Instant opacity swap |
| Modal open/close | Instant opacity swap |
| Drag ghost | Instant appear/disappear |
| Drop zone highlight | Instant color change |
| Button press | Instant scale/color |
| Switch toggle | Instant thumb position |

### What Removes (Non-Essential)
- All `transform` transitions (slide, scale, rotate)
- All `opacity` fades (except instant cross-fade)
- All `background-color` transitions
- All `box-shadow` transitions
- Skeleton shimmer
- Spinner rotation
- Page transitions
- Tooltip appear/dismiss
- Dropdown animations
- Tab switch cross-fade
- Card hover lift
- Toast slide
- Accordion height animation

---

## Interaction Feedback Rules (Mandatory)

### 1. Immediate Acknowledgment (<100ms)
- Button press: visual instant (scale/color)
- Touch: vibration (50ms) on drag start, button press
- Keyboard: focus ring instant

### 2. Loading States (Async Actions)
| Action | Trigger | Loading UI | Timeout |
|--------|---------|------------|---------|
| Create Task | Click Create | Button spinner, disabled | 10s → error |
| Save Task | Blur / Click Save | Button spinner / inline spinner | 10s |
| Delete Task | Confirm → Delete | Button spinner | 10s |
| Move Task | Drop | Ghost card, drop zone highlight | 5s (optimistic) |
| Load Board | Navigation | Skeleton board | 15s → retry |
| Load Modal | Click Card | Skeleton modal | 10s |

### 3. Success Feedback
| Action | Feedback | Duration |
|--------|----------|----------|
| Create Task | Toast "Task created" + card enter | Toast 2s, card 220ms |
| Save Task | Toast "Saved" | 1.5s |
| Move Task | Toast "Moved to [Column]" | 1.5s |
| Delete Task | Toast "Task deleted" + Undo | Toast 2s, Undo 3s |
| Archive Project | Toast "Project archived" | 2s |

### 4. Error Feedback
| Error Type | UI | Recovery |
|------------|-----|----------|
| Validation | Inline field error + summary alert + focus first error | Fix + resubmit |
| Network | Toast "Failed to [action]" + Retry button | Click Retry |
| Conflict | Inline "Updated by another user" + Refresh button | Click Refresh |
| Permission | Toast "You don't have permission" | N/A |
| Offline | Persistent banner "Offline — changes sync when online" | Auto-sync on reconnect |

### 5. Prevention (No Data Loss)
- **Double-submit prevention:** Buttons disable on click, re-enable on response/error
- **Dirty form protection:** Confirm "Discard changes?" on close/navigate
- **Optimistic UI:** Immediate visual, revert on failure + toast
- **Undo:** Delete → 3s undo toast, Archive → confirm modal

### 6. Empty States (Guided)
| Context | Illustration | Title | Description | Action |
|---------|--------------|-------|-------------|--------|
| No projects | Clipboard+plus | "No projects yet" | "Create your first project to start organizing tasks with your team" | "Create Project" |
| Empty board | Kanban columns | "Board is empty" | "Drag tasks here or create your first task" | "Create Task" |
| Empty column | Dashed zone | "Drag tasks here" | "Or add a task directly to this column" | "+ Add Task" |
| No filter results | Search+slash | "No tasks match" | "Try adjusting your filters or search terms" | "Clear filters" |
| No comments | Chat+slash | "No comments yet" | "Start the conversation" | (focus comment input) |
| No activity | Clock+slash | "No activity" | "Changes will appear here" | — |

---

## Performance Budgets (Motion)

| Metric | Budget | Measurement |
|--------|--------|-------------|
| **Animation FPS** | 60fps (16.67ms/frame) | `requestAnimationFrame` timestamps |
| **Long Tasks** | 0 >50ms | Long Task API |
| **CLS** | <0.1 | Layout Shift API |
| **INP** | <200ms | Interaction to Next Paint |
| **Animation Jitter** | 0 dropped frames | Frame Timing API |
| **Reduced Motion** | All durations 0ms | CSS computed style audit |

---

## Implementation Checklist (Per Interaction)

- [ ] Duration from token (`--motion-*`)
- [ ] Easing from token (`--easing-*`)
- [ ] Properties: transform/opacity only (GPU)
- [ ] `will-change` set during animation, removed after
- [ ] `prefers-reduced-motion` tested (0ms durations)
- [ ] Focus ring: 2px `--color-focus`, offset 2px
- [ ] Touch: 44×44px minimum, vibration on drag start
- [ ] Keyboard: full parity, live region announcements
- [ ] Screen reader: announcements for state changes
- [ ] No layout thrashing (FLIP for position changes)
- [ ] Interrupted animations: clean cancellation
- [ ] No animation on hidden elements (`content-visibility`)
- [ ] Toast: 5s minimum, pause on hover/focus
- [ ] Loading: skeleton matching final layout
- [ ] Error: inline + toast + focus management
- [ ] Success: toast + subtle UI update
- [ ] Undo: 3s minimum for destructive

---

## Motion Quality Gates (Automated)

| Gate | Criteria | Tool |
|------|----------|------|
| **Duration compliance** | All transitions use `--motion-*` tokens | CSS custom property audit |
| **Easing compliance** | All transitions use `--easing-*` tokens | CSS custom property audit |
| **GPU-only properties** | Only transform/opacity/box-shadow in transitions | Static analysis |
| **Reduced motion** | `@media (prefers-reduced-motion)` zeros all durations | CSS media query test |
| **Focus ring** | `:focus-visible` 2px `--color-focus` on all interactive | Selector audit |
| **Touch targets** | 44×44px minimum on all interactive | aXe + custom |
| **No layout animation** | No width/height/top/left/margin/padding in transitions | Static analysis |
| **FLIP for position** | Drag/reorder uses FLIP technique | Code review |
| **Skeleton match** | Skeleton structure matches final component | Visual regression |
| **Performance** | 60fps, no long tasks, CLS <0.1 | Lighthouse CI |