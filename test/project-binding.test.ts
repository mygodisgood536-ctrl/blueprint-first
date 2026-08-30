/** Chat/document↔project binding (expansion §10). */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { ProjectRegistry } from '../src/project/registry.ts';
import { DocumentProjectBinder } from '../src/chat/project-binding.ts';
import { makeServices } from './helpers/test-services.ts';
import type { CoreServices } from '../src/core/services.ts';

const ACTOR = { kind: 'system', id: 'project-registry' } as const;
const SYSTEM = { kind: 'system', id: 'chat-binder' } as const;
const OWNER = { userId: 'product-owner-01' } as const;

function buildRegistry(): { registry: ProjectRegistry; services: CoreServices } {
  const base = makeServices();
  const services: CoreServices = {
    store: base.store,
    allocator: base.allocator,
    graph: base.graph,
    evidence: base.evidence,
    router: base.router,
    logger: base.logger,
  };
  return { registry: new ProjectRegistry(services), services };
}

async function createProject(registry: ProjectRegistry) {
  return registry.createProject({
    title: 'TeamTask',
    mode: 'full-product',
    owner: OWNER,
    actor: ACTOR,
  });
}

describe('DocumentProjectBinder', () => {
  it('binds a document to a project and records a scoped DOC artifact', async () => {
    const { registry, services } = buildRegistry();
    const project = await createProject(registry);
    const binder = new DocumentProjectBinder(services, registry);

    const { reference, bound } = await binder.attachDocument(
      project.id,
      'demo-owner',
      'Some long product specification text for binding.',
      SYSTEM,
    );

    assert.equal(bound.projectId, project.id);
    assert.equal(bound.documentId, reference.id);
    assert.equal(bound.bound, true);
    assert.ok(reference.contentHash.length > 0);

    const docs = await services.store.list({ types: ['DOC'], projectId: project.id });
    assert.equal(docs.length, 1);
    assert.equal(docs[0]!.attributes['documentId'], reference.id);

    const report = await binder.listForProject(project.id);
    assert.equal(report.projectId, project.id);
    assert.equal(report.documentCount, 1);
    assert.equal(report.documentIds[0], reference.id);
  });

  it('lists multiple documents and multiple owners for a project', async () => {
    const { registry, services } = buildRegistry();
    const project = await createProject(registry);
    const binder = new DocumentProjectBinder(services, registry);

    await binder.attachDocument(project.id, 'owner-a', 'Document A content here.', SYSTEM);
    await binder.attachDocument(project.id, 'owner-b', 'Document B content here.', SYSTEM);

    const report = await binder.listForProject(project.id);
    assert.equal(report.documentCount, 2);
    assert.equal(report.ownerCount, 2);
  });

  it('resolves the owning project of a bound document', async () => {
    const { registry, services } = buildRegistry();
    const project = await createProject(registry);
    const binder = new DocumentProjectBinder(services, registry);

    const { reference } = await binder.attachDocument(project.id, 'demo-owner', 'Doc content.', SYSTEM);
    const report = await binder.projectOfDocument(reference.id);

    assert.ok(report !== null);
    assert.equal(report?.projectId, project.id);
  });

  it('returns null when resolving an unknown document', async () => {
    const { registry, services } = buildRegistry();
    const project = await createProject(registry);
    const binder = new DocumentProjectBinder(services, registry);

    const report = await binder.projectOfDocument('doc_missing9999');
    assert.equal(report, null);
  });

  it('throws when binding to a project that does not exist', async () => {
    const { registry, services } = buildRegistry();
    const binder = new DocumentProjectBinder(services, registry);

    await assert.rejects(
      binder.attachDocument('PROJECT-9999', 'demo-owner', 'Doc content.', SYSTEM),
    );
  });
});
