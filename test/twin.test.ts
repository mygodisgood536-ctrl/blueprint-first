/**
 * Interactive Digital Twin (§1.4 / traceability §T.1–3) tests.
 *
 * The twin must bind every page element back to its DESIGN artifact, its
 * Discovery artifact, and the evidence that produced it — derived from
 * certified state, never invented. Gaps are reported honestly when a binding
 * or evidence anchor is genuinely absent.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AiDesignStudio } from '../src/design/studio.ts';
import { materializeDigitalTwin } from '../src/twin/materialize.ts';
import { discoverSample } from './helpers/test-services.ts';

const BRIEF = {
  name: 'TeamTask',
  vision: 'A lightweight task tracker that small teams can adopt in minutes.',
  targetUsers: ['small teams'],
};

describe('Digital Twin (§1.4)', () => {
  it('binds every page element to design -> discovery -> evidence', async () => {
    const { services, baseline } = await discoverSample(BRIEF);
    const design = await new AiDesignStudio(services).designFromBaseline(baseline);
    assert.equal(design.status, 'accepted');
    assert.ok(design.blueprintId !== undefined);

    const twin = await materializeDigitalTwin(services, baseline, design.blueprintId, {
      producer: { kind: 'system', id: 'test-digital-twin' },
    });

    assert.equal(twin.built, true);
    assert.equal(twin.pages.length, baseline.pages.length);
    assert.ok(twin.elementCount > 0, 'twin carries elements');
    assert.ok(twin.boundElementCount > 0, 'elements are realized by the design');
    assert.ok(twin.twinArtifactId.startsWith('TWIN-'));
    assert.equal((await services.store.require(twin.twinArtifactId)).type, 'TWIN');

    for (const page of twin.pages) {
      assert.ok(page.designId !== null, `${page.pageKey} has a PAGE-DESIGN artifact`);
      assert.equal(page.designBound, true);
      assert.ok(page.edges.some((e) => e.relation === 'DERIVED_FROM'));
      for (const element of page.elements) {
        // §T.1 chain: discovery artifact -> design artifact -> evidence.
        assert.ok(
          element.trace.some((t) => t.kind === 'discovery'),
          `${element.label} has its discovery step`,
        );
        assert.ok(
          element.trace.some((t) => t.kind === 'design'),
          `${element.label} is clickable through the design artifact`,
        );
        assert.ok(
          element.trace.some((t) => t.kind === 'evidence'),
          `${element.label} is traceable to evidence`,
        );
        assert.ok(element.evidenceIds.length > 0, `${element.label} has evidence records`);
        assert.equal(element.designArtifactId, page.designId);
      }
    }
  });

  it('uses the §0.18 project-anchored evidence rule so cluster-found elements stay traceable', async () => {
    const { services, baseline } = await discoverSample(BRIEF);
    const design = await new AiDesignStudio(services).designFromBaseline(baseline);
    assert.ok(design.blueprintId !== undefined);
    const twin = await materializeDigitalTwin(services, baseline, design.blueprintId);
    assert.ok(twin.evidenceCount > 0);

    // Baseline inventory items carry no DIRECT evidence (cluster responses are
    // anchored on the PROJECT record per §0.18), yet every element must still
    // resolve through the project-level anchor — no false gaps.
    for (const page of twin.pages) {
      for (const element of page.elements) {
        assert.equal(element.evidenceIds.length > 0, true);
        const direct = await services.evidence.forArtifact(element.discoveryArtifactId);
        if (direct.length === 0) {
          const viaProject = await services.evidence.forArtifact(baseline.projectId);
          assert.ok(viaProject.length > 0, `${element.discoveryArtifactId} resolves via project anchor`);
        }
      }
    }
  });

  it('reports a page without a design package as an unrealizable-twin error (§T.3)', async () => {
    const { services, baseline } = await discoverSample(BRIEF);
    // No design stage ran: there is no PAGE-*-DESIGN to bind to.
    const twin = await materializeDigitalTwin(services, baseline, null);

    assert.equal(twin.blueprintId, null);
    for (const page of twin.pages) {
      assert.equal(page.designId, null);
      assert.equal(page.designBound, false);
      assert.ok(
        page.gaps.some((g) => g.severity === 'error' && /no PAGE-\d+-DESIGN/.test(g.message)),
        `${page.pageKey} surfaces the missing-design error gap`,
      );
    }
    assert.equal(twin.gapCount >= baseline.pages.length, true);
  });

  it('surfaces unbound element warnings when the design does not realize a discovered surface', async () => {
    const { services, baseline } = await discoverSample(BRIEF);
    // Pre-write a page design artifact with an EMPTY design doc so this unit
    // test can exercise the §T.2 unbound warning without a design stage: the
    // twin sees a PAGE-DESIGN artifact whose doc realizes nothing.
    const designId = `${baseline.pages[0]!.artifactId}-DESIGN`;
    const orphanDesign = await services.store.require(baseline.pages[0]!.artifactId);
    await services.store.append({
      ...orphanDesign,
      id: designId,
      title: 'Page design: empty',
      description: 'Fixture EMPTY design doc.',
      dependencies: [],
      attributes: {
        designDoc: {
          layout: [],
          interactions: [],
          stateHandling: [],
          accessibility: [],
          securityNotes: [],
          nonFunctionalRequirements: [],
        },
      },
    });
    const twin = await materializeDigitalTwin(services, baseline, null);
    const page = twin.pages.find((p) => p.pageId === baseline.pages[0]!.artifactId);
    assert.ok(page !== undefined);
    assert.ok(page.elements.length > 0);
    // At least one section/action/validation/content element is unbound -> warning.
    assert.ok(
      page.gaps.some((g) => g.severity === 'warning' && /not realized by any surface/.test(g.message)),
      'unbound element must surface a §T.2 warning',
    );
  });
});