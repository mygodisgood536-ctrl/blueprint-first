/** Design foundation + design-coverage-as-governance (expansion §10). */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { PageDesignDoc } from '../src/design/types.ts';
import {
  assessDesignCoverage,
  designCoverageGate,
  pageDesignEvidences,
  recordDesignCoverageEvidence,
} from '../src/design/coverage.ts';
import type { DesignCoverageAssessment } from '../src/project/types.ts';
import { MemoryEvidenceLog } from '../src/verification/evidence.ts';
import { discoverSample } from './helpers/test-services.ts';
import { generatePageDesign } from '../src/design/generate-page.ts';

/** A page design doc with the full structured visual/token foundation. */
function richDoc(): PageDesignDoc {
  return {
    pageArtifactId: 'PAGE-0001',
    pageKey: 'task-board',
    title: 'Task Board',
    purpose: 'See all tasks at a glance.',
    moduleId: 'MODULE-0001',
    navigation: { inMainNav: true, route: '/task-board', label: 'Task Board' },
    layout: [
      { sectionKey: 'board-columns', title: 'Columns', contentType: 'kanban', layoutHint: 'Multi-column board.' },
      { sectionKey: 'board-toolbar', title: 'Toolbar', contentType: 'toolbar', layoutHint: 'Horizontal action bar.' },
    ],
    interactions: [
      {
        actionArtifactId: 'ACTION-0001',
        actionKey: 'create-task',
        title: 'Create task',
        outcome: 'New task saved to first column.',
        validationMessages: ['Title is required.'],
      },
    ],
    stateHandling: [
      { stateArtifactId: 'STATE-0001', name: 'Empty board', whenVisible: 'No tasks exist.' },
    ],
    functionalRequirements: ['When "Create task" is triggered: New task saved to first column.'],
    nonFunctionalRequirements: ['Responsive down to a 360px viewport.'],
    dataNotes: 'Product entities: task.',
    apiNotes: 'API surface: create-task-api, list-tasks-api.',
    securityNotes: [
      { permissionKey: 'manage-tasks', resource: 'task', roles: ['admin', 'member'], appliesHere: true },
    ],
    constraints: 'Preserve workflow ordering.',
    designTokens: {
      color: { primary: '#2563eb', danger: '#dc2626' },
      typography: { baseFontSize: '16px', body: { size: '1rem' }, heading: { size: '1.5rem' } },
      spacing: { unit: '8px' },
      radius: { unit: '8px' },
      elevation: { unit: '4px' },
    },
    variants: [{ key: 'compact-columns', appliedTo: 'kanban', notes: 'Collapse below 768px.' }],
    responsive: [
      { behavior: 'Multi-column layout collapses to a single column below 768px.' },
      { behavior: 'Page stays usable, without horizontal scrolling, down to a 360px viewport.' },
    ],
    accessibility: [
      { guideline: 'WCAG 2.1 AA - keyboard operability', implementation: 'All controls reachable by keyboard.' },
    ],
  };
}

/** A structurally empty doc that evidences almost nothing. */
function sparseDoc(): PageDesignDoc {
  return {
    pageArtifactId: 'PAGE-0001',
    pageKey: 'task-board',
    title: 'Task Board',
    purpose: 'See all tasks at a glance.',
    moduleId: 'MODULE-0001',
    navigation: { inMainNav: true, route: '/task-board', label: 'Task Board' },
    layout: [],
    interactions: [],
    stateHandling: [],
    functionalRequirements: [],
    nonFunctionalRequirements: [],
    dataNotes: '',
    apiNotes: '',
    securityNotes: [],
    constraints: '',
  };
}

describe('design-coverage assessment + governance gate', () => {
  it('evidences the core structured dimensions from a rich design doc', () => {
    const covered = pageDesignEvidences(richDoc());
    for (const dim of [
      'product-vision',
      'pages-screens',
      'workflows',
      'components',
      'interactions',
      'navigation',
      'layout-structure',
      'visual-hierarchy',
      'color',
      'typography',
      'spacing',
      'visual-identity',
      'responsive-behavior',
      'mobile-design',
      'accessibility',
      'security-considerations',
      'business-admin-requirements',
    ] as const) {
      assert.ok(covered.has(dim), `expected ${dim} to be covered`);
    }
  });

  it('does not fabricate coverage for dimensions a sparse doc does not address', () => {
    const covered = pageDesignEvidences(sparseDoc());
    assert.ok(!covered.has('interactions'));
    assert.ok(!covered.has('accessibility'));
    assert.ok(!covered.has('responsive-behavior'));
    assert.ok(!covered.has('error-states'));
  });

  it('assesses a project: covered are unioned, missing are reported honestly, hash is a sha256 anchor', async () => {
    const assessment = assessDesignCoverage({ pageDesigns: [richDoc()], mode: 'full-product' });
    assert.ok(assessment.covered.includes('color'));
    assert.ok(assessment.covered.includes('accessibility'));
    // Every dimension the taxonomy requires is present whether covered or not.
    assert.equal(assessment.allDimensions.length, assessment.covered.length + assessment.missing.length);
    assert.match(assessment.assessmentHash, /^sha256:[0-9a-f]{64}$/);
    // Deterministic.
    const again = assessDesignCoverage({ pageDesigns: [richDoc()], mode: 'full-product' });
    assert.equal(again.assessmentHash, assessment.assessmentHash);
  });

  it('governance gate is satisfied only when no required dimension is missing', () => {
    const full: DesignCoverageAssessment = {
      allDimensions: [],
      covered: ['color', 'accessibility'],
      missing: [],
      assessmentHash: 'sha256:0'.padEnd(71, '0'),
    };
    assert.equal(designCoverageGate(full).satisfied, true);

    const partial: DesignCoverageAssessment = {
      allDimensions: [],
      covered: ['color'],
      missing: ['accessibility'],
      assessmentHash: 'sha256:0'.padEnd(71, '0'),
    };
    const gate = designCoverageGate(partial);
    assert.equal(gate.satisfied, false);
    assert.deepEqual(gate.missing, ['accessibility']);
  });

  it('records coverage assessment as evidence on the existing EvidenceLog', async () => {
    const evidence = new MemoryEvidenceLog();
    const assessment = assessDesignCoverage({ pageDesigns: [richDoc()], mode: 'full-product' });
    await recordDesignCoverageEvidence(evidence, assessment, {
      producerId: 'design-coverage',
      projectId: 'PROJECT-0001',
      pageDesignIds: ['PAGE-0001-DESIGN'],
    });
    const records = await evidence.all();
    const matching = records.filter((r) => /Design coverage assessed/.test(r.summary));
    assert.equal(matching.length, 1);
    assert.match(matching[0]!.payloadRef ?? '', /^sha256:/);
    assert.deepEqual(matching[0]!.artifactIds, ['PROJECT-0001', 'PAGE-0001-DESIGN']);
  });
});

describe('design generation emits the structured visual/token foundation', () => {
  it('generatePageDesign produces tokens, variants, responsive and accessibility fields', async () => {
    const { services, baseline } = await discoverSample({
      name: 'TeamTask',
      vision: 'A lightweight task tracker.',
      targetUsers: ['small teams'],
    });
    const pageEntry = baseline.pages[0]!;
    const doc = await generatePageDesign(services, baseline, pageEntry);

    assert.ok(doc.designTokens, 'expect structured design tokens');
    assert.ok(doc.designTokens!.color?.primary, 'expect a primary color token');
    assert.ok(doc.designTokens!.typography?.baseFontSize, 'expect a base font size');
    assert.ok(doc.designTokens!.spacing?.unit, 'expect a spacing unit');
    assert.ok((doc.responsive ?? []).length > 0, 'expect responsive rules');
    assert.ok((doc.accessibility ?? []).length > 0, 'expect accessibility rules');
    assert.ok((doc.variants ?? []).length > 0, 'expect variants');

    // The structured fields feed the coverage assessment end to end.
    const covered = pageDesignEvidences(doc);
    assert.ok(covered.has('accessibility'));
    assert.ok(covered.has('responsive-behavior'));
    assert.ok(covered.has('color'));
  });
});

describe('deeper design generation satisfies the full coverage gate (§12)', () => {
  it('emits derived states, variants, iconography, imagery and notifications', async () => {
    const { services, baseline } = await discoverSample({
      name: 'TeamTask',
      vision: 'A lightweight task tracker.',
      targetUsers: ['small teams'],
    });
    const doc = await generatePageDesign(services, baseline, baseline.pages[0]!);

    // Derived runtime states (loading/empty) — separate from discovered states.
    const runtimeNames = (doc.runtimeStates ?? []).map((s) => s.name.toLowerCase());
    assert.ok(runtimeNames.includes('loading'), 'expected a derived loading runtime state');
    assert.ok(runtimeNames.includes('empty'), 'expected a derived empty runtime state');

    // Derived disabled + motion variants.
    const variantKeys = (doc.variants ?? []).map((v) => v.key);
    assert.ok(variantKeys.some((k) => /disabled/.test(k)), 'expected a disabled variant');
    assert.ok(variantKeys.some((k) => /motion|animat/.test(k)), 'expected a motion variant');

    // Iconography, imagery and notification feedback.
    assert.ok((doc.iconography ?? []).length > 0, 'expected iconography');
    assert.ok((doc.imagery ?? []).length > 0, 'expected imagery');
    assert.ok((doc.notificationStates ?? []).length > 0, 'expected notification states');
  });

  it('closes every previously-missing dimension so the governance gate is satisfied', async () => {
    const { services, baseline } = await discoverSample({
      name: 'TeamTask',
      vision: 'A lightweight task tracker.',
      targetUsers: ['small teams'],
    });
    const docs = await Promise.all(
      (baseline.pages ?? []).map((p) => generatePageDesign(services, baseline, p)),
    );

    const assessment = assessDesignCoverage({ pageDesigns: docs, mode: 'full-product' });
    for (const dim of ['loading-states', 'disabled-states', 'animation', 'icons', 'imagery', 'notifications']) {
      assert.ok(assessment.covered.includes(dim as typeof assessment.covered[number]), `expected ${dim} covered`);
    }
    assert.equal(assessment.missing.length, 0, `expected no missing, got ${assessment.missing.join(', ')}`);
    assert.equal(designCoverageGate(assessment).satisfied, true);
  });
});
