/**
 * Document upload view — drag-and-drop + file picker + text paste path.
 *
 * Backend contract:
 *   POST /api/documents/upload  (multipart, "file" field) → { document, fileName }
 *   POST /api/chat/ingest      (json { text }) → IngestionResult (short→message vs large→document)
 */
import { api } from '../api.js';
import { router } from '../router.js';
import { toasts } from '../ui/toast.js';

const MAX_BYTES = 5 * 1024 * 1024;

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

function renderMarkup() {
  return `
    <div class="page">
      <header class="page__header">
        <div>
          <a class="back-link" href="#/documents">← All documents</a>
          <h1 class="page__title">Upload document</h1>
          <p class="page__subtitle">Text files up to 5 MB. Large pasted prompts are stored as document references automatically.</p>
        </div>
      </header>
      <section class="card upload-zone" id="upload-zone" tabindex="0" aria-label="Upload area">
        <div class="upload-zone__icon">⬆</div>
        <p class="upload-zone__hint">Drop a text file here, or <label class="upload-zone__link" for="file-input">choose one</label>.</p>
        <input class="upload-zone__file" type="file" id="file-input" accept=".txt,.md,.markdown,.text,text/plain,text/markdown" />
        <p class="upload-zone__limit">Max 5 MB · text-only</p>
      </section>
      <div class="upload-progress" id="upload-progress" hidden>
        <div class="upload-progress__bar"><div class="upload-progress__fill" id="upload-progress-fill"></div></div>
        <div class="upload-progress__text" id="upload-progress-text">Uploading…</div>
      </div>
      <section class="card">
        <h2 class="panel__title">Or paste text</h2>
        <p class="muted">Short inputs stay inline chat messages. Inputs at or above 4,000 characters are auto-stored as a document reference.</p>
        <textarea class="form-textarea" id="paste-text" rows="6" placeholder="Paste a brief, spec, or any long prompt…"></textarea>
        <div class="form-actions">
          <button class="btn btn--secondary" id="paste-clear-btn">Clear</button>
          <button class="btn btn--primary" id="paste-submit-btn">Send</button>
        </div>
        <div class="ingest-result" id="ingest-result" hidden></div>
      </section>
    </div>`;
}

function wireDragAndDrop(zone, onFile) {
  ['dragenter', 'dragover'].forEach((ev) =>
    zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('upload-zone--over'); })
  );
  ['dragleave', 'drop'].forEach((ev) =>
    zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove('upload-zone--over'); })
  );
  zone.addEventListener('drop', (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (file) onFile(file);
  });
}

export function mount(params, account) {
  const content = document.querySelector('#app-content');
  if (!content) return;
  if (!account) { router.go('/login'); return () => {}; }

  content.innerHTML = renderMarkup();

  const zone = document.getElementById('upload-zone');
  const fileInput = document.getElementById('file-input');
  const pasteText = document.getElementById('paste-text');
  const pasteSubmit = document.getElementById('paste-submit-btn');
  const pasteClear = document.getElementById('paste-clear-btn');
  const result = document.getElementById('ingest-result');

  document.body.classList.add('main-app');

  wireDragAndDrop(zone, handleFile);
  zone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') fileInput.click(); });
  fileInput.addEventListener('change', () => { const f = fileInput.files?.[0]; if (f) handleFile(f); });
  pasteSubmit.addEventListener('click', () => onPaste(pasteText, result, pasteSubmit));
  pasteClear.addEventListener('click', () => { pasteText.value = ''; result.hidden = true; result.innerHTML = ''; });

  async function handleFile(file) {
    if (file.size > MAX_BYTES) {
      toasts.error('File too large', `Maximum upload size is ${formatBytes(MAX_BYTES)}.`);
      return;
    }
    const progress = document.getElementById('upload-progress');
    const fill = document.getElementById('upload-progress-fill');
    const text = document.getElementById('upload-progress-text');
    progress.hidden = false;
    fill.style.width = '0%';
    text.textContent = `Uploading ${file.name} (${formatBytes(file.size)})…`;
    try {
      const out = await api.uploadDocument(file);
      fill.style.width = '100%';
      text.textContent = `Uploaded ${file.name} → ${out.document?.id ?? ''}`;
      toasts.success('Document uploaded', out.fileName ?? file.name);
      setTimeout(() => {
        if (out.document?.id) router.go(`/documents/${encodeURIComponent(out.document.id)}`);
        else router.go('/documents');
      }, 400);
    } catch (err) {
      progress.hidden = true;
      toasts.error('Upload failed', err instanceof Error ? err.message : String(err));
    }
  }

  async function onPaste(textarea, resultEl, btn) {
    const text = textarea.value;
    if (!text || text.length === 0) {
      toasts.error('Empty input', 'Type or paste something to send.');
      return;
    }
    btn.disabled = true;
    try {
      const out = await api.chatIngest(text);
      resultEl.hidden = false;
      if (out.kind === 'message') {
        resultEl.innerHTML = `<div class="ingest-result__kind">Stays as a chat message</div><p class="ingest-result__preview">${esc(out.message ?? '')}</p>`;
        toasts.success('Message sent', 'Short input kept inline.');
      } else if (out.kind === 'document') {
        const ref = out.documentRef;
        resultEl.innerHTML = `<div class="ingest-result__kind">Stored as a document reference</div><p>${ref.charLength.toLocaleString()} chars · ${esc(ref.id)}</p><a class="btn btn--primary btn--sm" href="#/documents/${encodeURIComponent(ref.id)}">Open document</a>`;
        toasts.success('Document stored', `Created ${ref.id}.`);
      }
    } catch (err) {
      toasts.error('Ingest failed', err instanceof Error ? err.message : String(err));
    } finally {
      btn.disabled = false;
    }
  }

  return () => {};
}

