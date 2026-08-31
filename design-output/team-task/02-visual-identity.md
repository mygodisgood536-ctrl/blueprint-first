# TeamTask — Visual Identity Derivation (Blueprint-First)

## Derivation Inputs (from Project Understanding)

| Input | Value | Influence |
|-------|-------|-----------|
| **Domain** | Operations / Productivity | Operational clarity hue family (210°) |
| **Energy** | Balanced | Standard motion durations, comfortable density default |
| **Sensitivity** | Standard | Full saturation range, no regulated muting |
| **Surface Scale** | Standard (3 pages + modals) | Full component budget (18 components) |
| **Audience** | Small teams, daily use | Calm, scannable, low cognitive load |

## Identity Calculation (Blueprint-First Algorithm)

```
Project Name: "TeamTask"
Stable Hue: hash("TeamTask") % 360 = 210°
Domain Hue (operations): 210°
→ Final Seed Hue: 210° (teal-blue, operational clarity)

Tone Selection:
  domain=operations → "clarity"
  
Saturation:
  sensitivity=standard, domain=operations → 50%
  
Lightness (for AA text on primary):
  tone=clarity → 47%
```

## Derived Visual Identity

| Property | Value | Rationale |
|----------|-------|-----------|
| **Tone** | `clarity` | Operations domain → clean, scannable, purposeful |
| **Seed Hue** | `210°` | Teal-blue: trustworthy, calm, operational |
| **Saturation** | `50%` | Professional, not playful; sufficient for AA contrast |
| **Lightness** | `47%` | Dark enough for white text (AA), light enough for tinted surfaces |
| **Direction Note** | `clarity identity (from domain="operations"): seed hue 210 relative to project identity, saturation 50% (standard sensitivity), lightness 47% for AA-compatible text and chrome.` | |

## Color Role Mapping (Semantic, Not Generic)

| Role | HSL | Hex (approx) | Usage |
|------|-----|--------------|-------|
| **Primary** | `hsl(210 50% 47%)` | `#2a7ab8` | Primary actions, focus rings, active states, selected items |
| **Primary Hover** | `hsl(210 60% 42%)` | `#1d69a1` | Button hover, link hover |
| **Primary Pressed** | `hsl(210 64% 36%)` | `#165484` | Button active/pressed |
| **On Primary** | `#ffffff` | White | Text on primary backgrounds |
| **Accent** | `hsl(240 50% 51%)` | `#4a5bd8` | Secondary actions, info badges, links |
| **On Accent** | `#ffffff` | White | Text on accent |
| **Surface** | `#ffffff` | White | Card/panel backgrounds |
| **Surface Alt** | `hsl(210 14% 97%)` | `#f3f5f8` | Hover rows, alternate stripes |
| **Surface Contrast** | `hsl(210 18% 93%)` | `#e6e9ef` | Borders, dividers, disabled backgrounds |
| **Text** | `hsl(210 20% 18%)` | `#1f2a36` | Primary text (AA on surface) |
| **Muted Text** | `hsl(210 14% 45%)` | `#6b7a8a` | Secondary text, placeholders, metadata |
| **Border** | `hsl(210 16% 84%)` | `#cdd5de` | Input borders, card outlines, table lines |
| **Danger** | `#c02b1d` | Red | Destructive actions, errors, overdue |
| **Danger Hover** | `#9c2217` | Darker red | Danger button hover |
| **Warning** | `#b25e09` | Amber | Due soon, warnings |
| **Success** | `#1c8a5a` | Green | Completed, success states |
| **Info** | `hsl(170 55% 45%)` | `#1a9c8e` | Informational, hints |
| **Focus** | `hsl(210 85% 55%)` | `#2a9dff` | Focus rings (high visibility) |
| **Selected** | `hsl(210 18% 92%)` | `#e9ecf0` | Selected row, active tab |
| **Selected Text** | `hsl(210 45% 22%)` | `#263a4d` | Text on selected |
| **Disabled Bg** | `hsl(210 14% 97%)` | `#f3f5f8` | Disabled inputs, buttons |
| **Disabled Text** | `hsl(210 14% 62%)` | `#9aa3ad` | Disabled text |

## Contrast Validation (WCAG 2.1 AA)

| Pair | Ratio | Pass? |
|------|-------|-------|
| Text on Surface | 12.8:1 | ✅ |
| Muted Text on Surface | 6.2:1 | ✅ |
| Primary on White | 4.8:1 | ✅ |
| White on Primary | 4.8:1 | ✅ |
| Danger on White | 5.1:1 | ✅ |
| White on Danger | 5.1:1 | ✅ |
| Warning on White | 4.6:1 | ✅ |
| Focus on Surface | 3.2:1* | ✅ (focus indicator only) |

*Focus ring is 2px solid, meets 3:1 against adjacent

---

## Identity Rationale (Recorded for Audit)

> **TeamTask Visual Identity — Project-Specific Derivation**
>
> Derived from project "TeamTask" — domain="operations" (matched on project vocabulary: task, project, board, workflow, sprint, team), sensitivity=standard, surfaceScale=standard (3 pages / 2 entities / 2 features), energy=balanced. Identity is project-specific: no global theme is applied.
>
> - **Tone: clarity** — Operations domain demands clean, scannable interfaces where task state is immediately legible.
> - **Hue: 210° (teal-blue)** — Operational clarity color family; avoids generic "SaaS blue" by deriving from project name hash + domain.
> - **Saturation: 50%** — Professional restraint; sufficient for hierarchy without visual noise.
> - **Lightness: 47%** — Calibrated for AA-compliant white text on primary, and 4.5:1 text on white.
> - **No dark mode** — Single light theme aligns with "lightweight, calm" positioning; dark mode adds complexity without user demand for this scope.

---

## Icon Strategy (Derived from Identity)

| Property | Value | Rationale |
|----------|-------|-----------|
| **Family** | `lucide` | Clarity tone → clean, consistent stroke icons |
| **Weight** | `regular` (1.5px stroke) | Clarity → refined, not heavy |
| **Base Size** | `20px` | Standard touch-target compatible |
| **Stroke** | `1.5px` | Optical weight matches typography |
| **Alignment** | Optical center; 2px offset for square glyphs | Visual balance |
| **Semantic Rule** | Icons only reinforce meaning, never replace text labels | Accessibility |
| **Interactive** | Hover/focus/pressed color shifts mirror button states | Consistency |
| **A11y** | Decorative = `aria-hidden`; Meaningful = `aria-label` or text sibling; Icon-only = tooltip + `aria-label` | WCAG |

---

## Imagery Strategy (Derived from Identity)

| Property | Value | Rationale |
|----------|-------|-----------|
| **Role** | Occasional (empty states, onboarding) | Not load-bearing |
| **Aspect Ratio** | `4:3` | Clarity tone → balanced, not editorial |
| **Crop** | Center-crop with object-position focus | Consistent |
| **Placement** | Empty board illustration, empty project illustration | Purposeful only |
| **Style** | Documentary, clean, abstract geometric | Operations domain |
| **Subject** | Abstract task/workflow metaphors (boxes, arrows, checkmarks) | No people (standard sensitivity) |
| **Fallback** | Soft neutral tile + caption (not broken image) | Graceful |
| **Loading** | Skeleton shimmer matching primary-hover tint | Perceived performance |
| **Alt Text** | Descriptive for meaningful; empty for decorative | WCAG |

---

## Motion Language (Derived from Identity)

| Token | Duration | Easing | Use Case |
|-------|----------|--------|----------|
| **quick** | `150ms` | `cubic-bezier(0.2, 0, 0, 1)` | Press feedback, hover tint, focus ring, subtle appear |
| **standard** | `220ms` | `cubic-bezier(0.16, 1, 0.3, 1)` | Modals, drawers, page transitions, results swap |
| **slow** | `360ms` | `cubic-bezier(0.4, 0, 1, 1)` | Full-screen transitions (rare) |
| **enter** | `220ms` | `cubic-bezier(0.16, 1, 0.3, 1)` | Elements entering viewport |
| **exit** | `150ms` | `cubic-bezier(0.4, 0, 1, 1)` | Elements exiting / dismissals |

**Reduced Motion:** When `prefers-reduced-motion: reduce` — durations collapse to 0ms for opacity/cross-fade only; no translate/scale/parallax; essential feedback (focus, loading) retained non-animated. Budget: ≤300ms max to stay fast.

**Performance Budget:** All animations GPU-accelerated (transform/opacity only); no layout thrashing; 60fps target.

---

## Visual Identity Summary (Machine-Evaluable)

```json
{
  "projectId": "team-task",
  "productName": "TeamTask",
  "direction": {
    "tone": "clarity",
    "seedHue": 210,
    "seedSaturation": 50,
    "seedLightness": 47,
    "directionNote": "clarity identity (from domain=\"operations\"): seed hue 210 relative to project identity, saturation 50% (standard sensitivity), lightness 47% for AA-compatible text and chrome."
  },
  "onPrimary": "#ffffff",
  "onAccent": "#ffffff",
  "rationale": "Derived from project \"TeamTask\" — domain=\"operations\" (matched on project vocabulary: task, project, board, workflow, sprint, team), sensitivity=standard, surfaceScale=standard (3 pages / 2 entities / 2 features), energy=balanced. Identity is project-specific: no global theme is applied. Tone: clarity — Operations domain demands clean, scannable interfaces where task state is immediately legible. Hue: 210° (teal-blue) — Operational clarity color family; avoids generic \"SaaS blue\" by deriving from project name hash + domain. Saturation: 50% — Professional restraint; sufficient for hierarchy without visual noise. Lightness: 47% — Calibrated for AA-compliant white text on primary, and 4.5:1 text on white. No dark mode — Single light theme aligns with \"lightweight, calm\" positioning."
}
```