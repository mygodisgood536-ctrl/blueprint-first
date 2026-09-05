/**
 * Documents list view — per-user document library with real backend data.
 *
 * Backend contract:
 *   GET    /api/documents          → { documents: DocumentView[], count }
 *   DELETE /api/documents/:id      → 204
 */
import { api } from '../api.js';
import { router } from '../router.js';
import { toasts } from '../ui/toast.js';

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function mount(params, account) {
  const content = document.querySelector('#app-content');
  if (!content) return;
  if (!account) { router.go('/login'); return () => {}; }

  content.innerHTML = `
    <div class="page">
      <header class="page__header">
        <div>
          <h1 class="page__title">Documents</h1>
          <p class="page__subtitle">Uploaded briefs, specifications, and large pasted intents (max 5 MB, text-only).</p>
        </div>
        <button class="btn btn--primary" id="upload-btn">+ Upload</button>
      </header>

      <section id="documents-body">
        <div class="card card--skeleton" aria-hidden="true">Loading documents…</div>
      </section>
    </div>
  `;

  document.getElementById('upload-btn')?.addEventListener('click', () => router.go('/documents/upload'));
  document.body.classList.add('main-app');

  loadDocuments().catch(() => toasts.error('Failed to load', 'Could not load documents.'));

  async function loadDocuments() {
    const body = document.getElementById('documents-body');
    if (!body) return;

    let res;
    try {
      res = await api.listDocuments();
    } catch (err) {
      body.innerHTML = `
        <div class="error-state">
          <p>Could not load documents.</p>
          <button class="btn btn--secondary btn--sm" id="retry-btn">Retry</button>
        </div>`;
      document.getElementById('retry-btn')?.addEventListener('click', () => loadDocuments());
      return;
    }

    const documents = res.documents ?? [];
    if (documents.length === 0) {
      body.innerHTML = `
        <div class="empty-state">
          <div class="empty-state__icon">📄</div>
          <h3 class="empty-state__title">No documents yet</h3>
          <p class="empty-state__desc">Upload a brief, spec, or any long text and it will be stored as a document reference.</p>
          <button class="btn btn--primary" id="empty-upload-btn">Upload your first document</button>
        </div>`;
      document.getElementById('empty-upload-btn')?.addEventListener('click', () => router.go('/documents/upload'));
      return;
    }

    body.innerHTML = `
      <div class="document-grid">
        ${documents.map((d) => `
          <div class="document-card" data-id="${esc(d.id)}">
            <div class="document-card__header">
              <h3 class="document-card__title">${esc(d.id)}</h3>
              <span class="badge">${formatBytes(d.byteLength)}</span>
            </div>
            <p class="document-card__preview">${esc(d.preview || '(empty)')}</p>
            <div class="document-card__meta">
              <span>${d.charLength.toLocaleString()} chars</span>
              <span class="document-card__hash" title="${esc(d.contentHash ?? '')}">${esc((d.contentHash ?? '').slice(0, 12))}…</span>
            </div>
            <div class="document-card__actions">
              <a class="btn btn--primary btn--sm" href="#/documents/${encodeURIComponent(d.id)}">Open</a>
              <button class="btn btn--danger btn--sm document-delete-btn" data-id="${esc(d.id)}">Delete</button>
            </div>
          </div>`).join('')}
      </div>`;

    document.querySelectorAll('.document-delete-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        if (!id) return;
        if (confirm(`Delete document "${id}"? This cannot be undone.`)) {
          deleteDoc(id);
        }
      });
    });
  }

  async function deleteDoc(id) {
    try {
      await api.deleteDocument(id);
      toasts.success('Document deleted', 'The document was removed.');
      loadDocuments();
    } catch (err) {
      toasts.error('Delete failed', err instanceof Error ? err.message : String(err));
    }
  }

  return () => {};
}
