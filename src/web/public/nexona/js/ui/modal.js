/**
 * Modal dialog system with focus management and accessible semantics.
 */

let activeModal = null;
let savedFocus = null;

export function showModal(title, bodyContent, options = {}) {
  if (activeModal) return;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.setAttribute('data-modal', 'overlay');

  const dialog = document.createElement('div');
  dialog.className = 'modal';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'modal-title');
  dialog.setAttribute('tabindex', '-1');

  const header = document.createElement('div');
  header.className = 'modal__header';

  const titleEl = document.createElement('h2');
  titleEl.id = 'modal-title';
  titleEl.className = 'modal__title';
  titleEl.textContent = title;
  header.appendChild(titleEl);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'btn btn--icon';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.innerHTML = '×';
  closeBtn.addEventListener('click', () => closeModal());
  header.appendChild(closeBtn);
  dialog.appendChild(header);

  const body = document.createElement('div');
  body.className = 'modal__body';
  if (typeof bodyContent === 'string') {
    body.innerHTML = bodyContent;
  } else if (bodyContent) {
    body.appendChild(bodyContent);
  }
  dialog.appendChild(body);

  if (options.footer) {
    const footer = document.createElement('div');
    footer.className = 'modal__footer';
    footer.appendChild(options.footer);
    dialog.appendChild(footer);
  }

  overlay.appendChild(dialog);

  // Save focus and trap
  savedFocus = document.activeElement;
  document.body.appendChild(overlay);
  activeModal = overlay;
  dialog.focus();

  // Close on Escape
  const onKeydown = (e) => {
    if (e.key === 'Escape') {
      if (options.onCancel) options.onCancel();
      else closeModal();
    }
  };
  const onOutside = (e) => {
    if (e.target === overlay && !options.preventOutsideClose) closeModal();
  };

  overlay.addEventListener('click', onOutside);
  document.addEventListener('keydown', onKeydown);

  overlay._cleanup = () => {
    overlay.removeEventListener('click', onOutside);
    document.removeEventListener('keydown', onKeydown);
  };

  return { overlay, dialog, close: closeModal };
}

export function closeModal() {
  if (!activeModal) return;
  activeModal._cleanup?.();
  activeModal.style.transition = 'opacity 0.15s ease';
  activeModal.style.opacity = '0';
  setTimeout(() => {
    if (activeModal && activeModal.parentNode) {
      activeModal.parentNode.removeChild(activeModal);
    }
  }, 150);
  activeModal = null;
  if (savedFocus) savedFocus.focus?.();
}

export function updateModalBody(html) {
  if (!activeModal) return;
  const body = activeModal.querySelector('.modal__body');
  if (body) body.innerHTML = html;
}
