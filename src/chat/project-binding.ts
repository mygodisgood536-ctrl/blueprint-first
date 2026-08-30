/**
 * Chat/document→project binding (Increment 8).
 *
 * Associates documents (and by extension the chat references built from them)
 * with a project so they are scoped, routed and isolated per-project. Binding
 * records a DOC artifact in the store, links it into the Knowledge Graph, and
 * registers it against the project registry for scoped lookup.
 */
import type { CoreServices } from '../core/services.ts';
import type { Actor } from '../core/artifact.ts';
import { createArtifact } from '../core/artifact.ts';
import { syncArtifactToGraph } from '../core/graph.ts';
import { DocumentStore, type DocumentRef } from './document.ts';
import type { ProjectRegistry } from '../project/registry.ts';

export interface BoundDocument {
  readonly documentId: string;
  readonly projectId: string;
  readonly ownerId: string;
  readonly contentHash: string;
  readonly charLength: number;
  readonly bound: boolean;
}

export interface ProjectBindingReport {
  readonly projectId: string;
  readonly documentCount: number;
  readonly documentIds: readonly string[];
  readonly resolved: boolean;
  readonly ownerCount: number;
}

export class DocumentProjectBinder {
  private readonly services: CoreServices;
  private readonly documents: DocumentStore;
  private readonly registry: ProjectRegistry;

  constructor(services: CoreServices, registry: ProjectRegistry, documents?: DocumentStore) {
    this.services = services;
    this.registry = registry;
    this.documents = documents ?? new DocumentStore();
  }

  /**
   * Attaches a document to a project, creating a scoped DOC artifact linked via
   * the registry and Knowledge Graph. Throws if the project is unknown.
   */
  async attachDocument(
    projectId: string,
    ownerId: string,
    content: string,
    actor: Actor,
  ): Promise<{ reference: DocumentRef; bound: BoundDocument }> {
    const project = await this.registry.requireProject(projectId);
    const reference = this.documents.addDocument(ownerId, content);

    const at = new Date().toISOString();
    const docArtifact = createArtifact({
      id: this.services.allocator.nextId('DOC'),
      type: 'DOC',
      title: `Project document ${reference.id}`,
      projectId,
      actor,
      at,
      dependencies: [project.id],
      attributes: {
        documentId: reference.id,
        ownerId,
        contentHash: reference.contentHash,
        charLength: reference.charLength,
        byteLength: reference.byteLength,
        preview: reference.preview,
      },
    });
    await this.services.store.append(docArtifact);
    syncArtifactToGraph(this.services.graph, docArtifact);
    this.services.graph.link(project.id, 'CONTAINS', docArtifact.id);
    await this.registry.linkArtifact(projectId, docArtifact.id);

    return {
      reference,
      bound: {
        documentId: reference.id,
        projectId,
        ownerId,
        contentHash: reference.contentHash,
        charLength: reference.charLength,
        bound: true,
      },
    };
  }

  /** Lists all documents bound to a project by reading its DOC artifacts. */
  async listForProject(projectId: string): Promise<ProjectBindingReport> {
    const project = await this.registry.requireProject(projectId);
    const docs = (await this.services.store.list({ types: ['DOC'], projectId })).sort((a, b) =>
      a.id < b.id ? -1 : 1,
    );
    const ownerIds = new Set(docs.map((d) => d.attributes['ownerId'] as string));
    return {
      projectId,
      documentCount: docs.length,
      documentIds: docs.map((d) => d.attributes['documentId'] as string),
      resolved: project.status !== 'DRAFT',
      ownerCount: ownerIds.size,
    };
  }

  /** Resolves which project owns a document, supporting per-project isolation. */
  async projectOfDocument(documentId: string): Promise<ProjectBindingReport | null> {
    const docs = await this.services.store.list({ types: ['DOC'] });
    const found = docs.find((d) => d.attributes['documentId'] === documentId);
    if (found === undefined) return null;
    if (found.projectId === null) return null;
    return this.listForProject(found.projectId);
  }

  /** Returns the underlying document store (shared chat/document store). */
  get documentStore(): DocumentStore {
    return this.documents;
  }
}