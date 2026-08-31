# TeamTask — Complete Design Token System (Blueprint-First)

## Color Tokens (Full Semantic System)

```json
{
  "color": {
    "scheme": "light",
    "primary": "hsl(210 50% 47%)",
    "primaryHover": "hsl(210 60% 42%)",
    "primaryPressed": "hsl(210 64% 36%)",
    "primaryDisabled": "hsl(210 12% 80%)",
    "onPrimary": "#ffffff",
    "accent": "hsl(240 50% 51%)",
    "onAccent": "#ffffff",
    "secondary": "hsl(210 32% 94%)",
    "surface": "#ffffff",
    "surfaceAlt": "hsl(210 14% 97%)",
    "surfaceContrast": "hsl(210 18% 93%)",
    "text": "hsl(210 20% 18%)",
    "mutedText": "hsl(210 14% 45%)",
    "border": "hsl(210 16% 84%)",
    "danger": "#c02b1d",
    "dangerHover": "#9c2217",
    "warning": "#b25e09",
    "success": "#1c8a5a",
    "info": "hsl(170 55% 45%)",
    "focus": "hsl(210 85% 55%)",
    "selected": "hsl(210 18% 92%)",
    "selectedText": "hsl(210 45% 22%)",
    "disabledBg": "hsl(210 14% 97%)",
    "disabledText": "hsl(210 14% 62%)"
  }
}
```

## Typography Tokens (Display/Heading/Body/Caption Scale)

```json
{
  "typography": {
    "baseFontSize": "16px",
    "fontFamily": "\"Inter\", \"Segoe UI\", system-ui, sans-serif",
    "fallbackFamily": "ui-sans-serif, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif",
    "display": {
      "family": "\"Inter\", \"Segoe UI\", system-ui, sans-serif",
      "size": "2.25rem",
      "weight": "700",
      "lineHeight": "1.1",
      "letterSpacing": "-0.02em"
    },
    "heading": {
      "family": "\"Inter\", \"Segoe UI\", system-ui, sans-serif",
      "size": "1.5rem",
      "weight": "600",
      "lineHeight": "1.25",
      "letterSpacing": "-0.01em"
    },
    "body": {
      "family": "\"Inter\", \"Segoe UI\", system-ui, sans-serif",
      "size": "1rem",
      "weight": "400",
      "lineHeight": "1.5",
      "letterSpacing": "0"
    },
    "caption": {
      "family": "\"Inter\", \"Segoe UI\", system-ui, sans-serif",
      "size": "0.8125rem",
      "weight": "400",
      "lineHeight": "1.4",
      "letterSpacing": "0.01em"
    }
  }
}
```

**Type Hierarchy Application:**
- **Display (2.25rem/700):** Project title on dashboard, empty state headlines
- **Heading (1.5rem/600):** Board column headers, modal titles, section headers
- **Body (1rem/400):** Task titles, descriptions, comments, form labels
- **Caption (0.8125rem/400):** Metadata (due dates, assignees, points), timestamps, helper text

---

## Spacing Tokens (Scale + Density)

```json
{
  "spacing": {
    "unit": "4px",
    "scale": ["4px", "8px", "12px", "16px", "24px", "32px", "48px", "64px"],
    "pageMargin": "24px",
    "controlGap": "12px",
    "sectionGap": "48px",
    "componentGap": "16px",
    "density": "comfortable"
  }
}
```

**Density Modes:**
| Mode | Unit Scale Multiplier | Use Case |
|------|----------------------|----------|
| **Compact** | 0.75× | Power users, dense boards (persisted preference) |
| **Comfortable** | 1.0× (default) | Balanced readability |
| **Relaxed** | 1.25× | Accessibility preference, large screens |

**Spacing Application:**
- `pageMargin` (24px): Page edges, modal padding
- `sectionGap` (48px): Between major sections (board + filters)
- `componentGap` (16px): Between cards, form fields, button groups
- `controlGap` (12px): Within components (icon-label, input-button)

---

## Layout Tokens (Grid System)

```json
{
  "layout": {
    "gridColumns": 12,
    "columnGap": "24px",
    "rowGap": "24px",
    "maxWidth": "1280px",
    "container": "1120px",
    "alignment": "stretch"
  }
}
```

**Board Layout:**
- Desktop (≥1200px): 5 columns × 12-col grid = 2.4 cols each → max 5 visible
- Tablet (768–1199px): 3 columns visible + horizontal scroll (or 2-col stacked)
- Mobile (<768px): Stacked accordion columns

**Container Widths:**
- Dashboard/Project List: 1120px centered
- Board: Full viewport width (100vw) with column gaps
- Modals: 90vw max, 560px preferred

---

## Radius Tokens (Per-Component)

```json
{
  "radius": {
    "unit": "6px",
    "control": "8px",    // Buttons, inputs, selects, badges
    "card": "12px",      // Task cards, modals, dropdowns
    "modal": "16px",     // Modal containers, drawers
    "surface": "4px"     // Chips, tags, small overlays
  }
}
```

**Rationale:** Clarity tone → slightly rounded (not sharp like finance, not pill-like). 6px base unit scales cleanly.

---

## Elevation Tokens (Shadow System)

```json
{
  "elevation": {
    "unit": "0 1px 3px rgba(17,24,39,.08), 0 1px 2px rgba(17,24,39,.04)",
    "levels": [
      { "level": 0, "shadow": "none" },
      { "level": 1, "shadow": "0 1px 2px rgba(17,24,39,.06), 0 1px 3px rgba(17,24,39,.08)" },
      { "level": 2, "shadow": "0 2px 6px rgba(17,24,39,.10), 0 4px 12px rgba(17,24,39,.08)" },
      { "level": 3, "shadow": "0 8px 24px rgba(17,24,39,.14), 0 4px 8px rgba(17,24,39,.08)" }
    ]
  }
}
```

**Elevation Application:**
| Level | Components |
|-------|------------|
| 0 | Flat surfaces (board background, inline elements) |
| 1 | Task cards (resting), dropdown menus, tooltips |
| 2 | Hovered task cards, open dropdowns, toast notifications |
| 3 | Modals, drawers, full-screen overlays |

---

## Motion Tokens (Complete)

```json
{
  "motion": {
    "durationQuick": "150ms",
    "durationStandard": "220ms",
    "durationSlow": "360ms",
    "easingStandard": "cubic-bezier(0.2, 0, 0, 1)",
    "easingEnter": "cubic-bezier(0.16, 1, 0.3, 1)",
    "easingExit": "cubic-bezier(0.4, 0, 1, 1)",
    "reducedMotion": true
  }
}
```

**Motion Application Map:**

| Interaction | Duration | Easing | Properties |
|-------------|----------|--------|------------|
| Button press | 150ms | standard | transform: scale(0.98) |
| Button hover | 150ms | standard | background-color, border-color |
| Focus ring | 150ms | standard | box-shadow (inset + ring) |
| Card hover lift | 220ms | enter | transform: translateY(-2px) + shadow level 1→2 |
| Modal enter | 220ms | enter | opacity 0→1 + translateY(10px→0) + scale(0.95→1) |
| Modal exit | 150ms | exit | opacity 1→0 + translateY(0→10px) + scale(1→0.95) |
| Drawer slide | 220ms | enter/exit | translateX(100%→0) |
| Toast appear | 150ms | enter | opacity 0→1 + translateY(20px→0) |
| Toast dismiss | 150ms | exit | opacity 1→0 + translateX(0→100%) |
| Drag ghost | 0ms (instant) | — | opacity 0.8 + rotate(2deg) |
| Drop zone highlight | 150ms | standard | background-color pulse |
| Skeleton shimmer | 1500ms loop | linear | background-position animation |
| Tooltip | 150ms | standard | opacity + translateY(-4px) |
| Tab switch | 150ms | standard | opacity cross-fade |
| Accordion | 220ms | standard | height + opacity |

---

## Complete Token System (JSON Export)

```json
{
  "color": {
    "scheme": "light",
    "primary": "hsl(210 50% 47%)",
    "primaryHover": "hsl(210 60% 42%)",
    "primaryPressed": "hsl(210 64% 36%)",
    "primaryDisabled": "hsl(210 12% 80%)",
    "onPrimary": "#ffffff",
    "accent": "hsl(240 50% 51%)",
    "onAccent": "#ffffff",
    "secondary": "hsl(210 32% 94%)",
    "surface": "#ffffff",
    "surfaceAlt": "hsl(210 14% 97%)",
    "surfaceContrast": "hsl(210 18% 93%)",
    "text": "hsl(210 20% 18%)",
    "mutedText": "hsl(210 14% 45%)",
    "border": "hsl(210 16% 84%)",
    "danger": "#c02b1d",
    "dangerHover": "#9c2217",
    "warning": "#b25e09",
    "success": "#1c8a5a",
    "info": "hsl(170 55% 45%)",
    "focus": "hsl(210 85% 55%)",
    "selected": "hsl(210 18% 92%)",
    "selectedText": "hsl(210 45% 22%)",
    "disabledBg": "hsl(210 14% 97%)",
    "disabledText": "hsl(210 14% 62%)"
  },
  "typography": {
    "baseFontSize": "16px",
    "fontFamily": "\"Inter\", \"Segoe UI\", system-ui, sans-serif",
    "fallbackFamily": "ui-sans-serif, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif",
    "display": { "family": "\"Inter\", \"Segoe UI\", system-ui, sans-serif", "size": "2.25rem", "weight": "700", "lineHeight": "1.1", "letterSpacing": "-0.02em" },
    "heading": { "family": "\"Inter\", \"Segoe UI\", system-ui, sans-serif", "size": "1.5rem", "weight": "600", "lineHeight": "1.25", "letterSpacing": "-0.01em" },
    "body": { "family": "\"Inter\", \"Segoe UI\", system-ui, sans-serif", "size": "1rem", "weight": "400", "lineHeight": "1.5", "letterSpacing": "0" },
    "caption": { "family": "\"Inter\", \"Segoe UI\", system-ui, sans-serif", "size": "0.8125rem", "weight": "400", "lineHeight": "1.4", "letterSpacing": "0.01em" }
  },
  "spacing": {
    "unit": "4px",
    "scale": ["4px", "8px", "12px", "16px", "24px", "32px", "48px", "64px"],
    "pageMargin": "24px",
    "controlGap": "12px",
    "sectionGap": "48px",
    "componentGap": "16px",
    "density": "comfortable"
  },
  "radius": {
    "unit": "6px",
    "control": "8px",
    "card": "12px",
    "modal": "16px",
    "surface": "4px"
  },
  "elevation": {
    "unit": "0 1px 3px rgba(17,24,39,.08), 0 1px 2px rgba(17,24,39,.04)",
    "levels": [
      { "level": 0, "shadow": "none" },
      { "level": 1, "shadow": "0 1px 2px rgba(17,24,39,.06), 0 1px 3px rgba(17,24,39,.08)" },
      { "level": 2, "shadow": "0 2px 6px rgba(17,24,39,.10), 0 4px 12px rgba(17,24,39,.08)" },
      { "level": 3, "shadow": "0 8px 24px rgba(17,24,39,.14), 0 4px 8px rgba(17,24,39,.08)" }
    ]
  },
  "layout": {
    "gridColumns": 12,
    "columnGap": "24px",
    "rowGap": "24px",
    "maxWidth": "1280px",
    "container": "1120px",
    "alignment": "stretch"
  },
  "motion": {
    "durationQuick": "150ms",
    "durationStandard": "220ms",
    "durationSlow": "360ms",
    "easingStandard": "cubic-bezier(0.2, 0, 0, 1)",
    "easingEnter": "cubic-bezier(0.16, 1, 0.3, 1)",
    "easingExit": "cubic-bezier(0.4, 0, 1, 1)",
    "reducedMotion": true
  }
}
```

---

## CSS Custom Properties (Implementation-Ready)

```css
:root {
  /* Color */
  --color-primary: hsl(210 50% 47%);
  --color-primary-hover: hsl(210 60% 42%);
  --color-primary-pressed: hsl(210 64% 36%);
  --color-primary-disabled: hsl(210 12% 80%);
  --color-on-primary: #ffffff;
  --color-accent: hsl(240 50% 51%);
  --color-on-accent: #ffffff;
  --color-secondary: hsl(210 32% 94%);
  --color-surface: #ffffff;
  --color-surface-alt: hsl(210 14% 97%);
  --color-surface-contrast: hsl(210 18% 93%);
  --color-text: hsl(210 20% 18%);
  --color-muted-text: hsl(210 14% 45%);
  --color-border: hsl(210 16% 84%);
  --color-danger: #c02b1d;
  --color-danger-hover: #9c2217;
  --color-warning: #b25e09;
  --color-success: #1c8a5a;
  --color-info: hsl(170 55% 45%);
  --color-focus: hsl(210 85% 55%);
  --color-selected: hsl(210 18% 92%);
  --color-selected-text: hsl(210 45% 22%);
  --color-disabled-bg: hsl(210 14% 97%);
  --color-disabled-text: hsl(210 14% 62%);

  /* Typography */
  --font-family: "Inter", "Segoe UI", system-ui, sans-serif;
  --font-family-fallback: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --font-size-base: 16px;
  --font-size-display: 2.25rem;
  --font-size-heading: 1.5rem;
  --font-size-body: 1rem;
  --font-size-caption: 0.8125rem;
  --font-weight-display: 700;
  --font-weight-heading: 600;
  --font-weight-body: 400;
  --font-weight-caption: 400;
  --line-height-display: 1.1;
  --line-height-heading: 1.25;
  --line-height-body: 1.5;
  --line-height-caption: 1.4;
  --letter-spacing-display: -0.02em;
  --letter-spacing-heading: -0.01em;
  --letter-spacing-body: 0;
  --letter-spacing-caption: 0.01em;

  /* Spacing */
  --space-unit: 4px;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --space-8: 32px;
  --space-12: 48px;
  --space-16: 64px;
  --space-page-margin: 24px;
  --space-control-gap: 12px;
  --space-section-gap: 48px;
  --space-component-gap: 16px;

  /* Radius */
  --radius-unit: 6px;
  --radius-control: 8px;
  --radius-card: 12px;
  --radius-modal: 16px;
  --radius-surface: 4px;

  /* Elevation */
  --elevation-0: none;
  --elevation-1: 0 1px 2px rgba(17,24,39,.06), 0 1px 3px rgba(17,24,39,.08);
  --elevation-2: 0 2px 6px rgba(17,24,39,.10), 0 4px 12px rgba(17,24,39,.08);
  --elevation-3: 0 8px 24px rgba(17,24,39,.14), 0 4px 8px rgba(17,24,39,.08);

  /* Layout */
  --layout-columns: 12;
  --layout-column-gap: 24px;
  --layout-row-gap: 24px;
  --layout-max-width: 1280px;
  --layout-container: 1120px;

  /* Motion */
  --motion-quick: 150ms;
  --motion-standard: 220ms;
  --motion-slow: 360ms;
  --easing-standard: cubic-bezier(0.2, 0, 0, 1);
  --easing-enter: cubic-bezier(0.16, 1, 0.3, 1);
  --easing-exit: cubic-bezier(0.4, 0, 1, 1);
}

@media (prefers-reduced-motion: reduce) {
  :root {
    --motion-quick: 0ms;
    --motion-standard: 0ms;
    --motion-slow: 0ms;
  }
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## Token Usage Rules (Governance)

1. **Never use raw hex/hsl in components** — always reference CSS custom properties
2. **Semantic over literal** — use `--color-primary` not `--color-blue-500`
3. **Density respects user preference** — `comfortable` default, `compact` opt-in via class on `<html>`
4. **Motion respects `prefers-reduced-motion`** — all transitions use CSS custom properties
5. **Focus always visible** — `--color-focus` ring on all interactive elements
6. **Contrast validated** — all text/background pairs meet 4.5:1 (AA) or 3:1 (UI)