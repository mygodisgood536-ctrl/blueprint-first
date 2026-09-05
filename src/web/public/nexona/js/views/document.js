/**
 * Document detail view — shows full content for the owner, with delete.
 *
 * Backend contract:
 *   GET    /api/documents/:id?full=true → DocumentView (with `content`)
 *   DELETE /api/documents/:id           → 204
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

  const id = params.id;
  if (!id) { router.go('/documents'); return () => {}; }

  content.innerHTML = `
    <div class="page">
      <header class="page__header">
        <div>
          <a class="back-link" href="#/documents">← All documents</a>
          <h1 class="page__title" id="doc-title">${esc(id)}</h1>
          <p class="page__subtitle" id="doc-subtitle">Loading…</p>
        </div>
        <button class="btn btn--danger" id="doc-delete-btn">Delete</button>
      </header>

      <section id="doc-body">
        <div class="card card--skeleton" aria-hidden="true">Loading document…</div>
      </section>
    </div>
  `;

  document.getElementById('doc-delete-btn')?.addEventListener('click', () => {
    if (confirm(`Delete document "${id}"? This cannot be undone.`)) {
      deleteDoc();
    }
  });

  document.body.classList.add('main-app');

  loadDocument().catch(() => toasts.error('Failed to load', 'Could not load document.'));

  async function loadDocument() {
    const body = document.getElementById('doc-body');
    if (!body) return;

    let doc;
    try {
      doc = await api.getDocument(id);
    } catch (err) {
      const status = err && typeof err === 'object' && 'status' in err ? err.status : 0;
      if (status === 404) {
        body.innerHTML = `
          <div class="error-state">
            <div class="error-state__icon">❌</div>
            <h3 class="error-state__title">Document not found</h3>
            <p class="error-state__desc">It may have been deleted or it belongs to another account.</p>
            <a class="btn btn--secondary" href="#/documents">Back to documents</a>
          </div>`;
      } else {
        body.innerHTML = `
          <div class="error-state">
            <p>Could not load document.</p>
            <button class="btn btn--secondary btn--sm" id="retry-btn">Retry</button>
          </div>`;
        document.getElementById('retry-btn')?.addEventListener('click', () => loadDocument());
      }
      return;
    }

    const subtitle = document.getElementById('doc-subtitle');
    if (subtitle) {
      subtitle.textContent = `${doc.charLength.toLocaleString()} chars · ${formatBytes(doc.byteLength)} · ${doc.contentHash ?? ''}`;
    }

    const full = doc.content ?? '(no content returned)';
    body.innerHTML = `
      <article class="card document-detail">
        <div class="document-detail__preview">
          <span class="document-detail__label">Preview</span>
          <p>${esc(doc.preview || '(empty)')}</p>
        </div>
        <div class="document-detail__content">
          <span class="document-detail__label">Full content</span>
          <pre class="document-detail__pre">${esc(full)}</pre>
        </div>
      </article>`;
  }

  async function deleteDoc() {
    try {
      await api.deleteDocument(id);
      toasts.success('Document deleted', 'The document was removed.');
      router.go('/documents');
    } catch (err) {
      toasts.error('Delete failed', err instanceof Error ? err.message : String(err));
    }
  }

  return () => {};
}
