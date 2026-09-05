/**
 * Toast notification system.
 * Usage: toasts.show({ title: 'Saved', message: 'Project created.', type: 'success' });
 */

const container = document.createElement('div');
container.id = 'toast-container';
container.setAttribute('aria-live', 'polite');
container.setAttribute('aria-atomic', 'true');
document.body.appendChild(container);

let counter = 0;

function createToast(config) {
  const toast = document.createElement('div');
  toast.className = `toast toast--${config.type || 'info'}`;
  toast.setAttribute('role', 'alert');
  toast.setAttribute('aria-hidden', 'true');

  const icon = document.createElement('div');
  icon.className = 'toast__icon';
  icon.textContent = config.type === 'error' ? '!' : config.type === 'success' ? '✓' : 'ⓘ';
  toast.appendChild(icon);

  const content = document.createElement('div');
  content.className = 'toast__content';

  const title = document.createElement('div');
  title.className = 'toast__title';
  title.textContent = config.title;
  content.appendChild(title);

  if (config.message) {
    const msg = document.createElement('div');
    msg.className = 'toast__message';
    msg.textContent = config.message;
    content.appendChild(msg);
  }

  toast.appendChild(content);

  const dismiss = document.createElement('button');
  dismiss.className = 'toast__dismiss';
  dismiss.setAttribute('aria-label', 'Dismiss');
  dismiss.textContent = '×';
  dismiss.addEventListener('click', () => removeToast(toast, id));
  toast.appendChild(dismiss);

  const id = `toast-${++counter}`;
  toast.setAttribute('data-toast-id', id);
  return { element: toast, id };
}

function removeToast(toast, id) {
  toast.classList.add('toast--hiding');
  toast.setAttribute('aria-hidden', 'true');
  setTimeout(() => {
    if (toast.parentNode) toast.parentNode.removeChild(toast);
  }, 200);
}

// Auto-dismiss after a duration
const autoDismiss = new Map();
function scheduleAutoDismiss(id, ms = 5000) {
  if (autoDismiss.has(id)) clearTimeout(autoDismiss.get(id));
  autoDismiss.set(id, setTimeout(() => {
    const toast = document.querySelector(`[data-toast-id="${id}"]`);
    if (toast) removeToast(toast, id);
    autoDismiss.delete(id);
  }, ms));
}

export const toasts = {
  show(config) {
    const { element, id } = createToast(config);
    container.appendChild(element);
    toast(element);
    // duration 0 = persist until dismissed; Infinity = persist; otherwise auto-dismiss.
    if (config.duration !== 0 && config.duration !== Infinity) {
      scheduleAutoDismiss(id, config.duration ?? 5000);
    }
    return id;
  },
  success(title, message) { return this.show({ title, message, type: 'success' }); },
  error(title, message) { return this.show({ title, message, type: 'error', duration: 0 }); },
  info(title, message) { return this.show({ title, message, type: 'info' }); },
};

// Animate in
function toast(el) {
  requestAnimationFrame(() => {
    el.style.transition = 'transform 0.25s ease, opacity 0.25s ease';
    el.style.transform = 'translateX(0)';
    el.style.opacity = '1';
  });
  el.style.transform = 'translateX(120%)';
  el.style.opacity = '0';
}
