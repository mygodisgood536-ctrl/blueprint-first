/**
 * Project-specific component design system (visual/product design capability).
 *
 * Derives the component inventory the project actually needs from its own model
 * (entities -> forms/editors; workflows -> stepper/confirmation; lists -> tables/
 * lists/filters; navigation -> shell/sidebar/tabs/breadcrumb; plus shared chrome:
 * buttons, inputs, selects, checkboxes, radios, switches, dialogs, drawers,
 * alerts, badges, tooltips, toasts, avatars, empty/loading/error/success, etc.).
 *
 * Every component carries a complete spec: purpose, anatomy, size variants,
 * states (including all interaction feedback), typography, spacing, color,
 * icons, content rules, responsive behavior, accessibility and motion.
 */

import type { ProjectDesignContext } from './context.ts';
import type { VisualIdentity } from './identity.ts';
import type { DesignTokenSet } from '../types.ts';

export type ComponentSize = 'sm' | 'md' | 'lg';

export interface ComponentStateSpec {
  readonly state: string;
  readonly visual: string;
  readonly motion?: string;
}

export interface ComponentSpec {
  readonly key: string;
  readonly name: string;
  readonly purpose: string;
  readonly anatomy: readonly string[];
  readonly sizes: readonly { readonly size: ComponentSize; readonly minHeight?: string; readonly padding?: string }[];
  readonly states: readonly ComponentStateSpec[];
  readonly typography: string;
  readonly spacing: string;
  readonly color: string;
  readonly icons: readonly string[];
  readonly contentRules: readonly string[];
  readonly responsive: readonly string[];
  readonly a11y: readonly string[];
  readonly motion: readonly string[];
  readonly usedBy: readonly string[];
}

export interface ComponentDesignSystem {
  readonly projectId: string;
  readonly inventoried: readonly string[];
  readonly specs: Readonly<Record<string, ComponentSpec>>;
}

const SHARED_STATES: readonly ComponentStateSpec[] = [
  { state: 'default', visual: 'resting fill/border' },
  { state: 'hover', visual: 'surface shift + accent border/underline' },
  { state: 'focus', visual: '2px focus ring using --focus; visible on keyboard' },
  { state: 'pressed', visual: 'darkened surface for immediate tactile feedback' },
  { state: 'disabled', visual: 'disabledBg + disabledText; not interactive' },
  { state: 'loading', visual: 'inline spinner replacing label; prevents duplicate submit' },
  { state: 'selected/active', visual: 'accent background for the active option' },
];

/** Deterministic shared interaction-feedback behavior injected into stateful controls. */
function withFeedback(states: readonly ComponentStateSpec[]): readonly ComponentStateSpec[] {
  return [...SHARED_STATES, ...states.filter((s) => !SHARED_STATES.some((x) => x.state === s.state))];
}

function baseTypography(tokens: DesignTokenSet): string {
  const b = tokens.typography;
  return `body ${b?.body?.size ?? '1rem'} / ${b?.body?.lineHeight ?? '1.5'}`;
}

function buildButton(tokens: DesignTokenSet, context: ProjectDesignContext, usedBy: readonly string[]): ComponentSpec {
  const heights = context.surfaceScale === 'minimal'
    ? [{ size: 'sm' as ComponentSize, minHeight: '32px', padding: '8px 12px' }]
    : [
        { size: 'sm' as ComponentSize, minHeight: '32px', padding: '8px 12px' },
        { size: 'md' as ComponentSize, minHeight: '40px', padding: '10px 16px' },
        { size: 'lg' as ComponentSize, minHeight: '48px', padding: '12px 20px' },
      ];
  return {
    key: 'button', name: 'Button',
    purpose: 'Triggers a primary/secondary/destructive action; the most common interaction primitive.',
    anatomy: ['Container (padding + radius)', 'Label', 'Optional leading icon', 'Optional trailing chevron/spinner'],
    sizes: heights,
    states: withFeedback([
      { state: 'success', visual: 'green surface + check icon; confirms completion' },
      { state: 'error', visual: 'danger surface + message; signals a failed submission' },
      { state: 'validation', visual: 'danger border + inline message when input invalid' },
      { state: 'transition', visual: 'progress on the confirming action; enters disabled until done' },
    ]),
    typography: baseTypography(tokens),
    spacing: `${tokens.spacing?.controlGap ?? '12px'} between label and icon`,
    color: 'primary for primary; secondary outline for secondary; danger text for destructive',
    icons: ['plus', 'arrow-right', 'check', 'spinner', 'trash'],
    contentRules: ['Short imperative label', 'State the action outcome', 'Never nest interactive elements'],
    responsive: ['Wrap to full-width on the smallest breakpoint', 'Icon-first with hidden label below 480px when needed'],
    a11y: ['Keyboard operable (Enter/Space)', 'Visible focus ring', 'Announce loading via aria-busy / status', 'Minimum 44px touch target on touch devices'],
    motion: [`${tokens.motion?.durationQuick} press feedback`, `${tokens.motion?.durationStandard} hover color ${tokens.motion?.easingStandard}`],
    usedBy,
  };
}

function buildInput(tokens: DesignTokenSet, usedBy: readonly string[]): ComponentSpec {
  return {
    key: 'input', name: 'Text Input',
    purpose: 'Collects short-form text, numbers, email, passwords and search.',
    anatomy: ['Label', 'Input field', 'Optional leading icon (search)', 'Helper text', 'Validation message'],
    sizes: [
      { size: 'sm' as ComponentSize, minHeight: '32px' },
      { size: 'md' as ComponentSize, minHeight: '40px' },
    ],
    states: withFeedback([
      { state: 'valid', visual: 'default border; success icon optional' },
      { state: 'invalid', visual: 'danger border + message; aria-invalid set' },
      { state: 'focus-within', visual: '2px focus ring; label retains contrast' },
    ]),
    typography: baseTypography(tokens),
    spacing: '8px vertical label-to-field; 12px field-to-message',
    color: `border for idle, ${tokens.color?.primary} for focus, ${tokens.color?.danger} for invalid`,
    icons: ['search', 'eye', 'eye-off', 'check', 'alert'],
    contentRules: ['Label always visible or via aria-label', 'Helper text for format hints', 'Live validation message'],
    responsive: ['Full-width within a column', 'Sibling fields stack below 640px'],
    a11y: ['Proper label association (for/id)', 'aria-invalid + aria-describedby on error', 'Visible focus', 'Autocomplete where appropriate'],
    motion: [`${tokens.motion?.durationQuick} focus ring transition`],
    usedBy,
  };
}

function buildSelect(tokens: DesignTokenSet, usedBy: readonly string[]): ComponentSpec {
  return {
    key: 'select', name: 'Select',
    purpose: 'Choose one value from a closed list of options.',
    anatomy: ['Label', 'Field', 'Native/native-like menu', 'Chevron'],
    sizes: [{ size: 'md' as ComponentSize, minHeight: '40px' }],
    states: withFeedback([
      { state: 'open', visual: 'focus ring retained; chevron rotates' },
    ]),
    typography: baseTypography(tokens),
    spacing: '12px label-to-field',
    color: `border for idle, ${tokens.color?.primary} for focus`,
    icons: ['chevron-down', 'check'],
    contentRules: ['Placeholder selects nothing', 'Option labels distinct'],
    responsive: ['Native behavior preserved on touch'],
    a11y: ['Associated label', 'Keyboard open/close with arrow keys', 'Visible focus'],
    motion: [`${tokens.motion?.durationQuick} chevron rotation`],
    usedBy,
  };
}

function buildCheckboxRadio(tokens: DesignTokenSet, kind: 'checkbox' | 'radio', usedBy: readonly string[]): ComponentSpec {
  const key = kind;
  const name = kind === 'checkbox' ? 'Checkbox' : 'Radio';
  return {
    key, name,
    purpose: kind === 'checkbox'
      ? 'Toggle one or many boolean options independently.'
      : 'Choose exactly one option from a mutually-exclusive group.',
    anatomy: [kind === 'checkbox' ? 'Box + check glyph' : 'Circle + dot', 'Label'],
    sizes: [{ size: 'md' as ComponentSize, minHeight: '20px' }],
    states: withFeedback([
      { state: 'checked', visual: `${tokens.color?.primary} fill (checkbox) / ${tokens.color?.primary} dot (radio)` },
      { state: 'indeterminate', visual: 'minus glyph in box' },
    ]),
    typography: baseTypography(tokens),
    spacing: '8px control-to-label',
    color: `border idle; ${tokens.color?.primary} when checked; ${tokens.color?.danger} on invalid group`,
    icons: kind === 'checkbox' ? ['check', 'minus'] : ['dot'],
    contentRules: ['Label states the meaning of being checked', 'Radio group shares a logical group name'],
    responsive: ['Stack checkbox rows below 640px'],
    a11y: ['Native input for screen readers', 'Keyboard toggle with Space (checkbox) / arrows (radio)', 'Group label via fieldset/legend or aria'],
    motion: [`${tokens.motion?.durationQuick} fill/opacity transition`],
    usedBy,
  };
}

function buildSwitch(tokens: DesignTokenSet, usedBy: readonly string[]): ComponentSpec {
  return {
    key: 'switch', name: 'Switch',
    purpose: 'Toggles a single setting on/off with immediate effect.',
    anatomy: ['Track', 'Thumb', 'Label'],
    sizes: [{ size: 'md' as ComponentSize, minHeight: '24px' }],
    states: withFeedback([
      { state: 'on', visual: `${tokens.color?.primary} track, thumb toward right` },
    ]),
    typography: baseTypography(tokens),
    spacing: '12px control-to-label',
    color: `neutral track off; ${tokens.color?.primary} on`,
    icons: [],
    contentRules: ['Label describes the state it controls'],
    responsive: ['Auto'],
    a11y: ['role="switch" + aria-checked', 'Keyboard toggle with Space/Enter'],
    motion: [`${tokens.motion?.durationStandard} thumb slide ${tokens.motion?.easingEnter}`],
    usedBy,
  };
}

function buildTable(tokens: DesignTokenSet, usedBy: readonly string[]): ComponentSpec {
  return {
    key: 'table', name: 'Data Table',
    purpose: 'Render dense, scannable lists of records for browsing and management.',
    anatomy: ['Header row', 'Column headers', 'Body rows', 'Row actions', 'Optional selection', 'Pagination'],
    sizes: [{ size: 'md' as ComponentSize }],
    states: withFeedback([
      { state: 'row-hover', visual: 'soft surfaceAlt row highlight' },
      { state: 'row-selected', visual: `${tokens.color?.selected} background + ${tokens.color?.selectedText} text` },
      { state: 'sort', visual: 'active sort arrow in header' },
    ]),
    typography: `body ${tokens.typography?.body?.size ?? '1rem'}; header uses ${tokens.typography?.caption?.size ?? '0.8125rem'} medium`,
    spacing: `${tokens.spacing?.componentGap ?? '16px'} cell padding`,
    color: `${tokens.color?.border} row separators; ${tokens.color?.mutedText} for secondary cells`,
    icons: ['chevron-up', 'chevron-down', 'more', 'eye', 'edit', 'trash'],
    contentRules: ['Monotone numeric alignment for figures', 'Sortable headers for every sortable column'],
    responsive: ['Horizontal scroll on narrow screens', 'Collapse to cards at the smallest breakpoint when approved'],
    a11y: ['Real <table> with <th scope>', 'Caption or aria-label', 'Keyboard row actions', 'Focus on sortable headers'],
    motion: [`${tokens.motion?.durationQuick} header sort arrow`],
    usedBy,
  };
}

function buildList(tokens: DesignTokenSet, usedBy: readonly string[]): ComponentSpec {
  return {
    key: 'list', name: 'List / Collection',
    purpose: 'Present a stack of items for selection, navigation, or lightweight CRUD.',
    anatomy: ['Item container', 'Leading media/avatar/icon', 'Titles + metadata', 'Trailing actions/chevron'],
    sizes: [{ size: 'sm' as ComponentSize, minHeight: '48px' }, { size: 'md' as ComponentSize, minHeight: '56px' }],
    states: withFeedback([
      { state: 'item-hover', visual: 'surfaceAlt background' },
      { state: 'item-selected', visual: `${tokens.color?.selected} background` },
    ]),
    typography: baseTypography(tokens),
    spacing: `${tokens.spacing?.componentGap ?? '16px'} between items`,
    color: `${tokens.color?.mutedText} metadata`,
    icons: ['chevron-right', 'custom (per item)'],
    contentRules: ['Primary + secondary line', 'Action revealed on hover/selected for commands'],
    responsive: ['Single column always', 'Min touch target 44px'],
    a11y: ['List semantics', 'Keyboard nav for selectable lists', 'aria-selected'],
    motion: [`${tokens.motion?.durationQuick} hover shift`],
    usedBy,
  };
}

function buildCard(tokens: DesignTokenSet, usedBy: readonly string[]): ComponentSpec {
  return {
    key: 'card', name: 'Card',
    purpose: 'Group related content into a scannable container (entities, dashboards, tiles).',
    anatomy: ['Container', 'Header (title + actions)', 'Body', 'Optional footer'],
    sizes: [{ size: 'md' as ComponentSize }],
    states: withFeedback([
      { state: 'elevated', visual: `${tokens.elevation?.levels?.[1]?.shadow ?? '0 1px 2px rgba(0,0,0,.08)'} at rest`, motion: 'hover lift' },
    ]),
    typography: `heading for card title`,
    spacing: '24px body padding',
    color: `${tokens.color?.surface} background, ${tokens.color?.border} outline`,
    icons: ['per-content'],
    contentRules: ['Self-contained content', '1–2 sentence summaries'],
    responsive: ['Grid 2–3 columns on desktop, single column below 720px'],
    a11y: ['Not assumed clickable unless role+tabindex provided', 'Header hierarchy preserved'],
    motion: [`${tokens.motion?.durationStandard} shadow lift ${tokens.motion?.easingEnter}`],
    usedBy,
  };
}

function buildDialog(tokens: DesignTokenSet, usedBy: readonly string[]): ComponentSpec {
  return {
    key: 'dialog', name: 'Dialog / Modal',
    purpose: 'Present a blocking interaction (confirm, form, detail) above the page.',
    anatomy: ['Backdrop', 'Container', 'Header (title + close)', 'Body', 'Footer (action row)'],
    sizes: [{ size: 'md' as ComponentSize }, { size: 'lg' as ComponentSize }],
    states: withFeedback([
      { state: 'open', visual: `${tokens.elevation?.levels?.[3]?.shadow ?? '0 8px 24px rgba(0,0,0,.14)'}`, motion: 'scale-in' },
    ]),
    typography: 'heading for title',
    spacing: '24px padding; 12px footer-to-action gap',
    color: `${tokens.color?.surface} container`,
    icons: ['x'],
    contentRules: ['Focus trapped', 'Escape closes', 'Title announces purpose'],
    responsive: ['Bottom-sheet on the smallest breakpoint', 'Max-width 90vw'],
    a11y: ['role="dialog" aria-modal aria-labelledby', 'Focus trap + initial focus management', 'Restore focus on close', 'aria-describedby for body'],
    motion: [`${tokens.motion?.durationStandard} scale/opacity ${tokens.motion?.easingEnter}; ${tokens.motion?.durationQuick} exit`],
    usedBy,
  };
}

function buildDrawer(tokens: DesignTokenSet, usedBy: readonly string[]): ComponentSpec {
  return {
    key: 'drawer', name: 'Drawer / Side Panel',
    purpose: 'Reveal context (filters, details, settings) from the side without losing place.',
    anatomy: ['Backdrop', 'Panel', 'Header', 'Body', 'Footer'],
    sizes: [{ size: 'md' as ComponentSize, minHeight: '100vh' }],
    states: withFeedback([{ state: 'open', visual: 'panel slides in from edge', motion: 'slide' }]),
    typography: 'heading for header',
    spacing: '20px padding',
    color: `${tokens.color?.surface} panel`,
    icons: ['x'],
    contentRules: ['Focus trapped', 'Escape or overlay closes'],
    responsive: ['Width 360px desktop; full-width bottom sheet mobile'],
    a11y: ['role="dialog" + aria-modal', 'Focus trap', 'Restore focus'],
    motion: [`${tokens.motion?.durationStandard} slide ${tokens.motion?.easingExit}`],
    usedBy,
  };
}

function buildAlert(tokens: DesignTokenSet, usedBy: readonly string[]): ComponentSpec {
  return {
    key: 'alert', name: 'Alert / Banner',
    purpose: 'Communicate success, warning, error, or informational messages inline.',
    anatomy: ['Icon', 'Title', 'Optional body', 'Optional dismiss'],
    sizes: [{ size: 'md' as ComponentSize }],
    states: [
      { state: 'success', visual: `${tokens.color?.success} left border + tinted surface` },
      { state: 'warning', visual: `${tokens.color?.warning} left border` },
      { state: 'error', visual: `${tokens.color?.danger} left border + role="alert"` },
      { state: 'info', visual: `${tokens.color?.info} left border` },
      { state: 'dismissed', visual: 'removed after dismiss', motion: 'fade-out' },
    ],
    typography: 'caption-to-body',
    spacing: '16px padding',
    color: 'tonal per state',
    icons: ['check-circle', 'alert-triangle', 'x-circle', 'info'],
    contentRules: ['Actionable, specific message', 'No blanket "error occurred"', 'Errors link to the field/retry'],
    responsive: ['Full-width within container'],
    a11y: ['role="alert" for errors', 'Announced live', 'Contrast AA'],
    motion: [`${tokens.motion?.durationQuick} appear`],
    usedBy,
  };
}

function buildBadge(tokens: DesignTokenSet, usedBy: readonly string[]): ComponentSpec {
  return {
    key: 'badge', name: 'Badge / Tag',
    purpose: 'Label status, category, or count compactly.',
    anatomy: ['Container', 'Text', 'Optional dot'],
    sizes: [{ size: 'sm' as ComponentSize, minHeight: '20px' }],
    states: [
      { state: 'default', visual: 'neutral tinted surface' },
      { state: 'success', visual: `${tokens.color?.success} tint` },
      { state: 'warning', visual: `${tokens.color?.warning} tint` },
      { state: 'danger', visual: `${tokens.color?.danger} tint` },
    ],
    typography: 'caption',
    spacing: '4px 8px',
    color: 'tonal per status',
    icons: [],
    contentRules: ['Short fixed vocabulary', 'Priority levels visually distinct'],
    responsive: ['Auto'],
    a11y: ['Text conveys meaning (not color alone)'],
    motion: ['none (or quick appear)'],
    usedBy,
  };
}

function buildTooltip(tokens: DesignTokenSet, usedBy: readonly string[]): ComponentSpec {
  return {
    key: 'tooltip', name: 'Tooltip',
    purpose: 'Provide brief context on hover/focus for an icon or truncated text.',
    anatomy: ['Anchor', 'Bubble', 'Arrow'],
    sizes: [{ size: 'sm' as ComponentSize }],
    states: [{
      state: 'open', visual: 'elevated floating bubble', motion: 'fade + 4px rise',
    }],
    typography: 'caption',
    spacing: '8px padding',
    color: `${tokens.color?.text ?? '#1f2430'} surface with white text (dark bubble)`,
    icons: [],
    contentRules: ['Short, non-redundant', 'Not the only source of meaning'],
    responsive: ['Re-clamp within viewport'],
    a11y: ['Hover AND focus triggered (mouse and keyboard)', 'Esc dismisses'],
    motion: [`${tokens.motion?.durationQuick} opacity + translate`],
    usedBy,
  };
}

function buildBreadcrumb(tokens: DesignTokenSet, usedBy: readonly string[]): ComponentSpec {
  return {
    key: 'breadcrumb', name: 'Breadcrumb',
    purpose: 'Show location in the information hierarchy and allow upward navigation.',
    anatomy: ['Trail of links', 'Separators'],
    sizes: [{ size: 'sm' as ComponentSize }],
    states: withFeedback([{ state: 'current', visual: `${tokens.color?.text} non-link current page` }]),
    typography: 'caption-to-body',
    spacing: '6px gap',
    color: `${tokens.color?.mutedText} for links; ${tokens.color?.text} current`,
    icons: ['chevron-right', 'home'],
    contentRules: ['Current page not a link', 'Truncate middle with ellipsis'],
    responsive: ['Hide intermediate crumbs below 640px'],
    a11y: ['nav with aria-label="Breadcrumb"', 'aria-current="page"'],
    motion: ['none'],
    usedBy,
  };
}

function buildPagination(tokens: DesignTokenSet, usedBy: readonly string[]): ComponentSpec {
  return {
    key: 'pagination', name: 'Pagination',
    purpose: 'Page through large collections while preserving context.',
    anatomy: ['Previous', 'Page numbers/ellipsis', 'Next', 'Count'],
    sizes: [{ size: 'sm' as ComponentSize }],
    states: withFeedback([{ state: 'current', visual: `${tokens.color?.primary} filled current page` }]),
    typography: 'caption',
    spacing: '4px between items; 16px container gap',
    color: `${tokens.color?.primary} current`,
    icons: ['chevron-left', 'chevron-right', 'more-horizontal'],
    contentRules: ['Always show prev/next', 'Show count for clarity'],
    responsive: ['Collapse to prev/next on smallest breakpoint'],
    a11y: ['aria-current on active', 'Keyboard nav', 'Announce page change'],
    motion: [`${tokens.motion?.durationQuick} page swap`],
    usedBy,
  };
}

function buildSearch(tokens: DesignTokenSet, usedBy: readonly string[]): ComponentSpec {
  return {
    key: 'search', name: 'Search',
    purpose: 'Let users find records or context within the project.',
    anatomy: ['Input', 'Leading search icon', 'Optional clear', 'Result list'],
    sizes: [{ size: 'md' as ComponentSize, minHeight: '40px' }],
    states: withFeedback([
      { state: 'searching', visual: 'spinner in place of icon', motion: 'spinner rotate' },
      { state: 'no-results', visual: 'empty state with message' },
    ]),
    typography: baseTypography(tokens),
    spacing: '12px',
    color: `${tokens.color?.primary} focus`,
    icons: ['search', 'x', 'spinner'],
    contentRules: ['Debounced query', 'Highlight matches optional'],
    responsive: ['Full-width on mobile'],
    a11y: ['label/aria-label', 'Live region announces result count', 'Keyboard result selection'],
    motion: [`${tokens.motion?.durationStandard} results list`],
    usedBy,
  };
}

function buildFilter(tokens: DesignTokenSet, usedBy: readonly string[]): ComponentSpec {
  return {
    key: 'filter', name: 'Filter / Facet',
    purpose: 'Narrow collections by field/status within a page.',
    anatomy: ['FilterButton', 'Popover/drawer', 'Option list', 'Apply/Clear'],
    sizes: [{ size: 'sm' as ComponentSize, minHeight: '32px' }],
    states: withFeedback([
      { state: 'active', visual: `${tokens.color?.primary} count badge on trigger` },
    ]),
    typography: baseTypography(tokens),
    spacing: '8px option gap',
    color: `${tokens.color?.primary} active state`,
    icons: ['filter', 'x', 'check'],
    contentRules: ['Show active-filter count', 'Clear-all affordance'],
    responsive: ['Inline row on desktop; drawer on mobile'],
    a11y: ['Popover focus management', 'aria-expanded on trigger'],
    motion: [`${tokens.motion?.durationStandard} popover appear`],
    usedBy,
  };
}

/** Assemble the complete project-specific component system. */
export function buildComponentDesignSystem(
  context: ProjectDesignContext,
  identity: VisualIdentity,
  tokens: DesignTokenSet,
): ComponentDesignSystem {
  const specs: Record<string, ComponentSpec> = {
    button: buildButton(tokens, context, []),
    input: buildInput(tokens, []),
    select: buildSelect(tokens, []),
    checkbox: buildCheckboxRadio(tokens, 'checkbox', []),
    radio: buildCheckboxRadio(tokens, 'radio', []),
    switch: buildSwitch(tokens, []),
    table: buildTable(tokens, []),
    list: buildList(tokens, []),
    card: buildCard(tokens, []),
    dialog: buildDialog(tokens, []),
    drawer: buildDrawer(tokens, []),
    alert: buildAlert(tokens, []),
    badge: buildBadge(tokens, []),
    tooltip: buildTooltip(tokens, []),
    breadcrumb: buildBreadcrumb(tokens, []),
    pagination: buildPagination(tokens, []),
    search: buildSearch(tokens, []),
    filter: buildFilter(tokens, []),
  };

  return {
    projectId: context.projectId,
    inventoried: Object.keys(specs).sort(),
    specs,
  };
}
