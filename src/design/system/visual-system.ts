/**
 * Visual design-system orchestrator (visual/product design capability).
 *
 * Ties the project-specific pieces together: context -> identity -> token
 * system -> component system -> icon/imagery/motion strategies. The result is a
 * single, coherent, project-specific visual design system shared by every page
 * (so pages are consistent), while each page still gets its own visual spec.
 */

import type { BusinessModel } from '../../discovery/business-model.ts';
import type { DiscoveryBaseline } from '../../discovery/materialize.ts';
import type { DesignTokenSet } from '../types.ts';
import { deriveProjectDesignContext, type ProjectDesignContext } from './context.ts';
import { deriveVisualIdentity, type VisualIdentity } from './identity.ts';
import { buildDesignTokenSystem } from './tokens.ts';
import { buildComponentDesignSystem, type ComponentDesignSystem } from './components.ts';
import {
  buildIconStrategy, buildImageryStrategy, buildMotionLanguage,
  type IconStrategy, type ImageryStrategy, type MotionLanguage,
} from './strategies.ts';

export interface VisualDesignSystem {
  readonly projectId: string;
  readonly context: ProjectDesignContext;
  readonly identity: VisualIdentity;
  readonly tokens: DesignTokenSet;
  readonly components: ComponentDesignSystem;
  readonly icons: IconStrategy;
  readonly imagery: ImageryStrategy;
  readonly motion: MotionLanguage;
}

/**
 * Build the complete project-specific visual design system. Deterministic and
 * derived purely from the project's own artifacts — never a global/static theme.
 */
export function buildVisualDesignSystem(
  baseline: DiscoveryBaseline,
  businessModel?: BusinessModel | null,
): VisualDesignSystem {
  const context = deriveProjectDesignContext(baseline, businessModel);
  const identity = deriveVisualIdentity(context);
  const tokens = buildDesignTokenSystem(identity, context);
  const components = buildComponentDesignSystem(context, identity, tokens);
  const icons = buildIconStrategy(context, identity);
  const imagery = buildImageryStrategy(context, identity);
  const motion = buildMotionLanguage(context, {
    durationQuick: tokens.motion?.durationQuick,
    durationStandard: tokens.motion?.durationStandard,
    durationSlow: tokens.motion?.durationSlow,
    easingStandard: tokens.motion?.easingStandard,
    easingEnter: tokens.motion?.easingEnter,
    easingExit: tokens.motion?.easingExit,
  });
  return { projectId: baseline.projectId, context, identity, tokens, components, icons, imagery, motion };
}
