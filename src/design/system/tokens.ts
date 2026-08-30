/**
 * Full, project-specific design-token system builder (visual/product design
 * capability). Builds a complete, concrete DesignTokenSet — color (semantic +
 * states), typography (display/heading/body/caption), spacing (scale/density),
 * layout (grid/max-width), radius, elevation and motion — from the derived
 * visual identity and project context. Every value is deterministic and
 * project-specific; none are empty placeholders.
 */

import type {
  DesignColorTokens, DesignElevationLevel, DesignLayoutTokens, DesignMotionTokens,
  DesignRadiusTokens, DesignSpacingTokens, DesignTokenSet, DesignTypographyTokens,
} from '../types.ts';
import type { ProjectDesignContext } from './context.ts';
import type { VisualIdentity } from './identity.ts';

function hsl(h: number, s: number, l: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(100, n));
  return `hsl(${Math.round(h)} ${clamp(s)}% ${clamp(l)}%)`;
}

function buildColors(identity: VisualIdentity, context: ProjectDesignContext): DesignColorTokens {
  const { seedHue: h, seedSaturation: s, seedLightness: l } = identity.direction;
  const muted = Math.max(30, s - 22);
  const subtle = Math.max(18, s - 34);
  const regulated = context.sensitivity === 'regulated';

  const primary = hsl(h, s, l);
  // Light-theme surface/text are near-neutral; derived to sit quietly with the hue.
  const surface = '#ffffff';
  const surfaceAlt = hsl(h, 14, 97);
  const surfaceContrast = hsl(h, 18, 93);
  const text = identity.onPrimary;
  const mutedText = hsl(h, 20, 45);
  const border = hsl(h, 16, 84);
  const danger = regulated ? '#b42318' : '#c02b1d';
  const dangerHover = regulated ? '#912018' : '#9c2217';
  const warning = '#b25e09';
  const success = regulated ? '#0e7a4f' : '#1c8a5a';
  const info = hsl(Math.max(0, h - 40), 55, 45);
  const focus = hsl(h, 85, 55);
  const selected = hsl(h, 18, 92);
  const selectedText = hsl(h, 45, 22);

  return {
    scheme: 'light',
    primary,
    primaryHover: hsl(h, Math.min(100, s + 10), Math.max(0, l - 5)),
    primaryPressed: hsl(h, Math.min(100, s + 14), Math.max(0, l - 11)),
    primaryDisabled: hsl(h, 12, 80),
    onPrimary: '#ffffff',
    accent: hsl(Math.min(359, (h + 30) % 360), Math.min(100, s), Math.min(100, l + 4)),
    onAccent: identity.onAccent,
    secondary: hsl(h, 32, 94),
    surface,
    surfaceAlt,
    surfaceContrast,
    text,
    mutedText,
    border,
    danger,
    dangerHover,
    warning,
    success,
    info,
    focus,
    selected,
    selectedText,
    disabledBg: surfaceAlt,
    disabledText: hsl(h, 14, 62),
  };
}

function buildTypography(context: ProjectDesignContext): DesignTypographyTokens {
  const display = context.sensitivity === 'regulated' || context.domain === 'finance'
    ? 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
    : `"Inter", "Segoe UI", system-ui, sans-serif`;
  const bodyFamily = display;
  const googleFallback = `ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;

  return {
    baseFontSize: '16px',
    fontFamily: bodyFamily,
    fallbackFamily: googleFallback,
    display: {
      family: display, size: '2.25rem', weight: '700', lineHeight: '1.1', letterSpacing: '-0.02em',
    },
    heading: {
      family: display, size: '1.5rem', weight: '600', lineHeight: '1.25', letterSpacing: '-0.01em',
    },
    body: {
      family: bodyFamily, size: '1rem', weight: '400', lineHeight: '1.5', letterSpacing: '0',
    },
    caption: {
      family: bodyFamily, size: '0.8125rem', weight: '400', lineHeight: '1.4', letterSpacing: '0.01em',
    },
  };
}

function buildSpacing(context: ProjectDesignContext): DesignSpacingTokens {
  const density = context.surfaceScale === 'minimal' ? 'relaxed'
    : context.domain === 'finance' ? 'compact'
    : context.energy === 'high' ? 'compact' : 'comfortable';
  return {
    unit: '4px',
    scale: ['4px', '8px', '12px', '16px', '24px', '32px', '48px', '64px'],
    pageMargin: '24px',
    controlGap: '12px',
    sectionGap: '48px',
    componentGap: '16px',
    density,
  };
}

function buildRadius(context: ProjectDesignContext): DesignRadiusTokens {
  const sharp = context.domain === 'finance' || context.sensitivity === 'regulated';
  const unit = sharp ? '2px' : '6px';
  return {
    unit,
    control: sharp ? '4px' : '8px',
    card: sharp ? '6px' : '12px',
    modal: sharp ? '8px' : '16px',
    surface: sharp ? '2px' : '4px',
  };
}

function buildElevation(): { unit: string; levels: DesignElevationLevel[] } {
  return {
    unit: '0 1px 3px rgba(0,0,0,.08), 0 1px 2px rgba(0,0,0,.04)',
    levels: [
      { level: 0, shadow: 'none' },
      { level: 1, shadow: '0 1px 2px rgba(17,24,39,.06), 0 1px 3px rgba(17,24,39,.08)' },
      { level: 2, shadow: '0 2px 6px rgba(17,24,39,.10), 0 4px 12px rgba(17,24,39,.08)' },
      { level: 3, shadow: '0 8px 24px rgba(17,24,39,.14), 0 4px 8px rgba(17,24,39,.08)' },
    ],
  };
}

function buildLayout(context: ProjectDesignContext): DesignLayoutTokens {
  return {
    gridColumns: 12,
    columnGap: '24px',
    rowGap: '24px',
    maxWidth: context.domain === 'finance' ? '1200px' : '1280px',
    container: context.energy === 'high' ? '100vw' : '1120px',
    alignment: 'stretch',
  };
}

function buildMotion(context: ProjectDesignContext): DesignMotionTokens {
  const quick = context.energy === 'high' ? '120ms' : '150ms';
  const standard = context.energy === 'high' ? '200ms' : '220ms';
  const slow = context.energy === 'high' ? '300ms' : '360ms';
  return {
    durationQuick: quick,
    durationStandard: standard,
    durationSlow: slow,
    easingStandard: 'cubic-bezier(0.2, 0, 0, 1)',
    easingEnter: 'cubic-bezier(0.16, 1, 0.3, 1)',
    easingExit: 'cubic-bezier(0.4, 0, 1, 1)',
    // Reduced-motion is always supported when the platform requests it.
    reducedMotion: true,
  };
}

/**
 * Build the complete project-specific token system. Deterministic and derived
 * from the identity + context — no generic/global palette, no empty fields.
 */
export function buildDesignTokenSystem(
  identity: VisualIdentity,
  context: ProjectDesignContext,
): DesignTokenSet {
  const elevation = buildElevation();
  return {
    color: buildColors(identity, context),
    typography: buildTypography(context),
    spacing: buildSpacing(context),
    radius: buildRadius(context),
    elevation,
    layout: buildLayout(context),
    motion: buildMotion(context),
  };
}
