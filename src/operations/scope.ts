/**
 * Deployment scope derivation for the AI Operations & Observability Layer
 * (Stage 4, §4.1-§4.2).
 *
 * A release is scoped mechanically from the certified inventory: every base
 * FEATURE/PAGE that has a verified -TEST artifact (i.e. shipped through
 * Stage 3 acceptance) is scheduled for deployment. Nothing is hand-picked by
 * a worker; the scope is the certified acceptance closure.
 */

import type { CoreServices } from '../core/services.ts';
import { isBaseArtifactId } from '../core/ids.ts';

export interface DeployExpectation {
  readonly baseId: string;
  readonly kind: 'functional' | 'render';
}

/** True when the given base artifact already has a verified -TEST artifact. */
export async function hasAcceptedTest(
  services: CoreServices,
  baseId: string,
): Promise<boolean> {
  const test = await services.store.get(`${baseId}-TEST`);
  return test !== null && test.status === 'VERIFIED';
}

export async function deriveDeployScope(
  services: CoreServices,
  projectId: string,
): Promise<readonly DeployExpectation[]> {
  const features = await services.store.list({ types: ['FEATURE'], projectId });
  const pages = await services.store.list({ types: ['PAGE'], projectId });
  const out: DeployExpectation[] = [];
  for (const f of features) {
    if (isBaseArtifactId(f.id) && (await hasAcceptedTest(services, f.id))) {
      out.push({ baseId: f.id, kind: 'functional' });
    }
  }
  for (const p of pages) {
    if (isBaseArtifactId(p.id) && (await hasAcceptedTest(services, p.id))) {
      out.push({ baseId: p.id, kind: 'render' });
    }
  }
  return out;
}