/**
 * Icon, imagery and motion strategies (visual/product design capability).
 *
 * These strategies are derived from the project's identity and context — the
 * icon family, weight/stroke, imagery treatment, and motion language are chosen
 * to fit the project, not forced identically on every project.
 */

import type { ProjectDesignContext } from './context.ts';
import type { VisualIdentity } from './identity.ts';

export interface IconStrategy {
  readonly family: string;
  readonly weight: 'regular' | 'medium' | 'bold';
  readonly baseSize: string;
  readonly stroke: string;
  readonly alignment: string;
  readonly semantic: string;
  readonly interactive: string;
  readonly a11y: readonly string[];
}

export interface ImageryStrategy {
  readonly role: string;
  readonly aspectRatio: string;
  readonly crop: string;
  readonly placement: string;
  readonly style: string;
  readonly subject: string;
  readonly fallback: string;
  readonly loading: string;
  readonly alt: string;
}

export interface MotionLanguage {
  readonly durations: readonly { readonly token: string; readonly ms: string; readonly use: string }[];
  readonly easings: readonly { readonly token: string; readonly curve: string; readonly use: string }[];
  readonly reducedMotion: string;
}

export function buildIconStrategy(context: ProjectDesignContext, identity: VisualIdentity): IconStrategy {
  // Derived from tone: refined/trustworthy -> stroke, bold/strong -> heavierweight.
  const refinement = identity.direction.tone === 'refined' || identity.direction.tone === 'trustworthy';
  const weight: IconStrategy['weight'] = identity.direction.tone === 'strong' || context.energy === 'high' ? 'bold' : refinement ? 'regular' : 'medium';
  return {
    family: identity.direction.tone === 'expressive' ? 'phosphor' : 'lucide',
    weight,
    baseSize: '20px',
    stroke: refinement ? '1.5px' : '2px',
    alignment: 'optical center; 2px optical offset for square glyphs',
    semantic: 'icons only reinforce meaning, never replace text labels',
    interactive: 'hover/focus/pressed color shifts mirror button states',
    a11y: [
      'decorative icons are aria-hidden',
      'meaningful icons carry aria-label or text sibling',
      'icon-only controls expose a tooltip + aria-label',
    ],
  };
}

export function buildImageryStrategy(context: ProjectDesignContext, identity: VisualIdentity): ImageryStrategy {
  const dense = context.surfaceScale === 'large';
  return {
    role: dense ? 'complementary (never the load-bearing layout element)' : 'occasional',
    aspectRatio: identity.direction.tone === 'expressive' ? '16:10' : '4:3',
    crop: context.sensitivity === 'regulated' ? 'conservative, respectful' : 'center-crop with object-position focus',
    placement: 'header banners and empty/illustrative states only',
    style: context.domain === 'creative' ? 'editorial, high-contrast' : 'documentary, clean',
    subject: 'abstract/neutral; avoid people in regulated domains unless necessary',
    fallback: 'soft neutral tile + caption, not a broken-image icon',
    loading: 'skeleton shimmer matching primary-hover tint',
    alt: 'descriptive alt that preserves meaning; decorative images alt=""',
  };
}

export function buildMotionLanguage(context: ProjectDesignContext, tokens: {
  durationQuick?: string; durationStandard?: string; durationSlow?: string;
  easingStandard?: string; easingEnter?: string; easingExit?: string;
}): MotionLanguage {
  const d = context.energy === 'high' ? 1 : 1.1;
  const quick = tokens.durationQuick ?? '150ms';
  const standard = tokens.durationStandard ?? '220ms';
  const slow = tokens.durationSlow ?? '360ms';
  return {
    durations: [
      { token: 'quick', ms: quick, use: 'press feedback, hover tint, focus ring, subtle appear' },
      { token: 'standard', ms: standard, use: 'dialogs, drawers, page transitions, results swap' },
      { token: 'slow', ms: slow, use: 'full-screen transitions, large element entrances' },
    ],
    easings: [
      { token: 'standard', curve: tokens.easingStandard ?? 'cubic-bezier(0.2,0,0,1)', use: 'default property transitions' },
      { token: 'enter', curve: tokens.easingEnter ?? 'cubic-bezier(0.16,1,0.3,1)', use: 'elements entering viewport' },
      { token: 'exit', curve: tokens.easingExit ?? 'cubic-bezier(0.4,0,1,1)', use: 'elements exiting / dismissals' },
    ],
    reducedMotion:
      `when the user prefers reduced motion: durations collapse to 0-ms or instant for ` +
      `opacity/cross-fade only; no translate/scale/parallax; essential feedback (focus, ` +
      `loading) retained non-animated. (budget: ${d.toFixed(1)}x factor, <= 300ms max to stay fast)`,
  };
}
