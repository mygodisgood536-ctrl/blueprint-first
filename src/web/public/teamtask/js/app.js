const API = '/api/teamtask';
const toastContainer = document.getElementById('toast-container');
let _processing = new Set();

function escHtml(str) {
  if (typeof str !== 'string') return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function toast(message, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.setAttribute('role', 'status');
  el.textContent = message;
  toastContainer.appendChild(el);
  setTimeout(() => {
    el.classList.add('toast--exiting');
    el.addEventListener('animationend', () => el.remove());
  }, 3000);
}

function setBtnLoading(btn, loading) {
  if (!btn) return;
  if (loading) {
    btn.classList.add('is-loading');
    btn.disabled = true;
    btn.dataset.originalText = btn.textContent;
  } else {
    btn.classList.remove('is-loading');
    btn.disabled = false;
  }
}

async function api(path, options = {}) {
  const key = path + JSON.stringify(options.body || '');
  if (_processing.has(key)) return null;
  _processing.add(key);
  try {
    const res = await fetch(`${API}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    if (res.status === 204) return null;
    return res.json();
  } finally {
    _processing.delete(key);
  }
}

let currentProjectId = null;
let _modalFocusTrap = null;
let _sidebarOpen = false;
let _currentDragData = null;

async function loadProjects() {
  try {
    const data = await api('/projects');
    renderProjectList(data.projects);
    if (data.projects.length > 0) {
      const current = localStorage.getItem('teamtask-project') || data.projects[0].id;
      await loadProject(current);
    } else {
      renderEmptyProjects();
    }
  } catch (err) {
    document.getElementById('page-content').innerHTML = `
      <div class="error-state">
        <svg class="empty-state__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01" stroke-linecap="round"/></svg>
        <h2 class="error-state__title">Failed to load projects</h2>
        <p class="error-state__message">${escHtml(err.message)}</p>
        <button class="btn btn--primary" onclick="loadProjects()">Retry</button>
      </div>`;
  }
}

function renderEmptyProjects() {
  const list = document.getElementById('project-list');
  list.innerHTML = '';
  document.getElementById('page-title').textContent = 'TeamTask';
  document.getElementById('page-actions').innerHTML = '';
  const board = document.getElementById('page-content');
  board.innerHTML = `
    <div class="empty-state">
      <svg class="empty-state__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 12h6M12 9v6" stroke-linecap="round"/></svg>
      <h2 class="empty-state__title">No projects yet</h2>
      <p class="empty-state__description">Create your first project to start tracking tasks.</p>
      <button class="btn btn--primary" style="margin-top:var(--space-4)" onclick="promptNewProject()">Create Project</button>
    </div>`;
}

function renderProjectList(projects) {
  const list = document.getElementById('project-list');
  const current = localStorage.getItem('teamtask-project') || projects[0]?.id;
  list.innerHTML = projects.map(p => `
    <li class="sidebar__item" role="button" tabindex="0"
        aria-selected="${p.id === current}"
        data-project-id="${p.id}"
        data-name="${escHtml(p.name)}">
      <svg class="sidebar__item-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zm0 6a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1v-2zm0 6a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1v-2z" fill="currentColor"/></svg>
      <span>${escHtml(p.name)}</span>
    </li>`).join('');
}

async function selectProject(projectId) {
  if (projectId === currentProjectId) return;
  closeSidebar();
  await loadProject(projectId);
}

async function loadProject(projectId) {
  currentProjectId = projectId;
  localStorage.setItem('teamtask-project', projectId);
  try {
    const data = await api(`/projects/${projectId}`);
    const project = data.project;
    document.getElementById('page-title').textContent = project.name;
    document.getElementById('page-actions').innerHTML = `
      <button class="btn btn--primary btn--sm" id="btn-new-task" aria-label="Create new task">+ New Task</button>
      <button class="btn btn--secondary btn--sm" id="btn-invite" aria-label="Invite members">Invite</button>
      <button class="btn btn--ghost btn--sm" id="btn-settings" aria-label="Project settings">Settings</button>`;
    document.getElementById('btn-new-task')?.addEventListener('click', () => showCreateTaskModal());
    document.getElementById('btn-invite')?.addEventListener('click', showInviteModal);
    document.getElementById('btn-settings')?.addEventListener('click', showSettingsModal);
    renderProjectList([project]);
    document.querySelectorAll('.sidebar__item').forEach(el => {
      el.setAttribute('aria-selected', el.dataset.projectId === projectId ? 'true' : 'false');
    });
    renderBoard(project);
    detectLayout();
    closeSidebar();
  } catch (err) {
    document.getElementById('page-content').innerHTML = `
      <div class="error-state">
        <h2 class="error-state__title">Failed to load project</h2>
        <p class="error-state__message">${escHtml(err.message)}</p>
        <button class="btn btn--primary" onclick="loadProjects()">Retry</button>
      </div>`;
  }
}

function renderBoard(project) {
  const columns = project.columnConfig || [];
  const tasks = project.tasks || [];
  const board = document.getElementById('page-content');

  if (columns.length === 0) {
    board.innerHTML = `
      <div class="empty-state">
        <svg class="empty-state__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 12h6M12 9v6" stroke-linecap="round"/></svg>
        <h2 class="empty-state__title">No columns yet</h2>
        <p class="empty-state__description">Add columns to your board to organize tasks.</p>
      </div>`;
    return;
  }

  if (tasks.length === 0) {
    board.innerHTML = `
      <div class="board__toolbar">
        <button class="btn btn--secondary" id="btn-add-task-board" aria-label="Add a new task">+ Add Task</button>
      </div>
      <div class="board" id="board-columns" role="region" aria-label="Kanban board">
        ${columns.map(col => `
          <div class="board__column" data-column-id="${col.id}" role="list" aria-label="${escHtml(col.name)} (${0} tasks)">
            <div class="board__column-header">
              <div class="board__column-title">
                <span>${escHtml(col.name)}</span>
                <span class="board__column-count">0</span>
              </div>
            </div>
            <div class="board__column-body" data-column-body="${col.id}" role="group" aria-label="${escHtml(col.name)} tasks, empty">
              <p style="color:var(--color-muted-text);font-size:var(--font-size-caption);padding:var(--space-3);text-align:center">No tasks yet</p>
            </div>
            <div class="board__column-footer">
              <button class="btn btn--ghost btn--sm" style="width:100%" onclick="showCreateTaskModal('${col.id}')" aria-label="Add a task to ${escHtml(col.name)}">+ Add card</button>
            </div>
          </div>`).join('')}
      </div>`;
    document.getElementById('btn-add-task-board')?.addEventListener('click', () => showCreateTaskModal());
    return;
  }

  board.innerHTML = `
    <div class="board__toolbar">
      <button class="btn btn--secondary" id="btn-add-task-board" aria-label="Add a new task">+ Add Task</button>
    </div>
    <div class="board" id="board-columns" role="region" aria-label="Kanban board">
      ${columns.map(col => {
        const colTasks = tasks.filter(t => t.columnId === col.id);
        return `
          <div class="board__column" data-column-id="${col.id}" role="list" aria-label="${escHtml(col.name)} (${colTasks.length} tasks)">
            <div class="board__column-header">
              <div class="board__column-title">
                <span>${escHtml(col.name)}</span>
                <span class="board__column-count">${colTasks.length}</span>
              </div>
            </div>
            <div class="board__column-body" data-column-body="${col.id}" role="group" aria-label="${colTasks.length} tasks in ${escHtml(col.name)}">
              ${colTasks.length > 0 ? renderTaskCards(colTasks) : '<p style="color:var(--color-muted-text);font-size:var(--font-size-caption);padding:var(--space-3);text-align:center">No tasks yet</p>'}
            </div>
            <div class="board__column-footer">
              <button class="btn btn--ghost btn--sm" style="width:100%" onclick="showCreateTaskModal('${col.id}')" aria-label="Add a task to ${escHtml(col.name)}">+ Add card</button>
            </div>
          </div>`;
      }).join('')}
    </div>`;

  document.getElementById('btn-add-task-board')?.addEventListener('click', () => showCreateTaskModal());
}

function renderMobileBoard(project) {
  const columns = project.columnConfig || [];
  const tasks = project.tasks || [];
  const board = document.getElementById('page-content');
  if (columns.length === 0) {
    board.innerHTML = `<div class="empty-state"><p class="empty-state__description">No columns yet</p></div>`;
    return;
  }
  board.innerHTML = `
    <div class="mobile-board" id="mobile-board">
      ${columns.map((col, i) => {
        const colTasks = tasks.filter(t => t.columnId === col.id);
        return `
          <div class="mobile-board__column" role="region" aria-label="${escHtml(col.name)}">
            <div class="mobile-board__column-header" onclick="toggleMobileColumn(${i})" tabindex="0" role="button" aria-expanded="true" aria-controls="mobile-col-${i}" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleMobileColumn(${i})}">
              <span>${escHtml(col.name)}</span>
              <span class="board__column-count">${colTasks.length}</span>
            </div>
            <div class="mobile-board__column-body" id="mobile-col-${i}" aria-label="${colTasks.length} tasks">
              ${colTasks.length > 0 ? renderTaskCards(colTasks, true) : '<p style="color:var(--color-muted-text);font-size:var(--font-size-caption);padding:var(--space-3);text-align:center">No tasks</p>'}
            </div>
          </div>`;
      }).join('')}
    </div>`;
}

function toggleMobileColumn(idx) {
  const el = document.getElementById(`mobile-col-${idx}`);
  const header = el?.previousElementSibling;
  if (!el) return;
  const isCollapsed = el.classList.toggle('is-collapsed');
  header?.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
}

function renderTaskCards(taskCards, isMobile = false) {
  if (taskCards.length === 0) {
    return '<p style="color:var(--color-muted-text);font-size:var(--font-size-caption);padding:var(--space-2);text-align:center">No tasks</p>';
  }
  return taskCards.map(task => {
    const title = escHtml(task.title);
    const desc = task.description ? `<p class="task-card__description">${escHtml(task.description)}</p>` : '';
    const labels = task.labels ? task.labels.map(l => `<span class="badge badge--primary">${escHtml(l)}</span>`).join('') : '';
    const completed = task.isCompleted ? '<span class="badge badge--success">Done</span>' : '';
    const assignees = task.assignees && task.assignees.length > 0 ? `
      <div class="task-card__assignees" aria-label="Assigned to">
        ${task.assignees.map((a, i) => `<div class="avatar avatar--sm" style="background:hsl(${210 + i * 30} 50% 47%)" title="${escHtml(a.name || '')}">${escHtml((a.name || '').split(' ').map(n => n[0]).join('').slice(0, 2))}</div>`).join('')}
      </div>` : '';
    return `
      <div class="task-card" role="button" tabindex="0" draggable="true" data-task-id="${task.id}"
           aria-label="${title}${task.isCompleted ? ', completed' : ''}"
           onkeydown="if(event.key==='Enter'){event.preventDefault();showTaskDetail('${task.id}')}else if(event.key===' '){event.preventDefault();showTaskDetail('${task.id}')}"
           onclick="showTaskDetail('${task.id}')">
        <span class="task-card__move-btn" onclick="event.stopPropagation();showMoveMenu(event,'${task.id}')" aria-label="Move task" title="Move">
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M7 2v10M2 7h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        </span>
        <div class="task-card__move-menu" id="move-menu-${task.id}" style="display:none" role="menu" aria-label="Move task">
          <button role="menuitem" onclick="event.stopPropagation();moveTaskTo('${task.id}','backlog')">Backlog</button>
          <button role="menuitem" onclick="event.stopPropagation();moveTaskTo('${task.id}','todo')">To Do</button>
          <button role="menuitem" onclick="event.stopPropagation();moveTaskTo('${task.id}','in-progress')">In Progress</button>
          <button role="menuitem" onclick="event.stopPropagation();moveTaskTo('${task.id}','in-review')">In Review</button>
          <button role="menuitem" onclick="event.stopPropagation();moveTaskTo('${task.id}','done')">Done</button>
        </div>
        <h3 class="task-card__title">${title}</h3>
        ${desc}
        <div class="task-card__tags">${labels}${completed}</div>
        ${assignees}
      </div>`;
  }).join('');
}

function showMoveMenu(event, taskId) {
  event.stopPropagation();
  const menu = document.getElementById(`move-menu-${taskId}`);
  if (!menu) return;
  const isVisible = menu.style.display !== 'none';
  document.querySelectorAll('.task-card__move-menu').forEach(m => m.style.display = 'none');
  if (!isVisible) {
    menu.style.display = 'block';
    const btn = menu.previousElementSibling;
    btn?.focus();
    const firstItem = menu.querySelector('button');
    firstItem?.focus();
  }
}

document.addEventListener('click', () => {
  document.querySelectorAll('.task-card__move-menu').forEach(m => m.style.display = 'none');
});

async function moveTaskTo(taskId, columnId) {
  document.querySelectorAll('.task-card__move-menu').forEach(m => m.style.display = 'none');
  try {
    await api(`/projects/${currentProjectId}/tasks/${taskId}/move`, {
      method: 'POST',
      body: JSON.stringify({ columnId, order: 0 }),
    });
    toast('Task moved', 'success');
    await loadProject(currentProjectId);
  } catch (err) {
    toast('Failed to move task: ' + err.message, 'error');
  }
}

async function showTaskDetail(taskId) {
  try {
    const data = await api(`/projects/${currentProjectId}/tasks/${taskId}`);
    if (!data || !data.task) { toast('Task not found', 'error'); return; }
    renderTaskDetail(data.task);
  } catch (err) {
    toast('Failed to load task: ' + err.message, 'error');
  }
}

function renderTaskDetail(task) {
  const board = document.getElementById('page-content');
  const labels = task.labels ? task.labels.map(l => `<span class="badge badge--primary">${escHtml(l)}</span>`).join('') : '';
  const assigneesHtml = task.assignees && task.assignees.length > 0 ? `
    <div class="task-card__assignees" style="margin-top:var(--space-3)" aria-label="Assigned to">
      ${task.assignees.map((a, i) => `<div class="avatar avatar--sm" style="background:hsl(${210 + i * 30} 50% 47%)" title="${escHtml(a.name || '')}">${escHtml((a.name || '').split(' ').map(n => n[0]).join('').slice(0, 2))}</div>`).join('')}
    </div>` : '';
  board.innerHTML = `
    <button class="btn btn--ghost btn--sm" id="btn-back-to-board" aria-label="Back to board" style="margin-bottom:var(--space-3)">
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>
      Back
    </button>
    <div class="task-detail">
      <div class="task-detail__header">
        <h2 class="task-detail__title" id="detail-title">${escHtml(task.title)}</h2>
        <div style="display:flex;gap:var(--space-2)">
          <button class="btn btn--ghost btn--icon" id="btn-edit-task" aria-label="Edit task" title="Edit task" data-task-id="${task.id}">
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M11.5 1.5l3 3L6 13H3v-3z" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <button class="btn btn--ghost btn--icon" id="btn-delete-task" aria-label="Delete task" title="Delete task" data-task-id="${task.id}">
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4h12M5 4V3a1 1 0 011-1h4a1 1 0 011 1v1m1 0v9a1 1 0 01-1 1H5a1 1 0 01-1-1V4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
      </div>
      <div class="task-detail__body" id="detail-body">${task.description ? escHtml(task.description) : '<p style="color:var(--color-muted-text)">No description provided.</p>'}</div>
      <div class="task-detail__meta">
        ${labels}
        <span class="badge ${task.isCompleted ? 'badge--success' : 'badge--default'}">${task.isCompleted ? 'Completed' : 'In Progress'}</span>
        ${task.assignees ? `<span class="badge badge--default">${task.assignees.length} assignee(s)</span>` : ''}
      </div>
      ${assigneesHtml}
      <div class="task-detail__meta">
        <span class="task-detail__field">
          <svg class="task-detail__field-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1v12M2 8h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          ${task.order !== undefined ? `Position: ${task.order + 1}` : ''}
        </span>
      </div>
    </div>
    <div style="margin-top:var(--space-4)">
      <button class="btn btn--primary" id="btn-detail-back" aria-label="Back to board">Back to Board</button>
    </div>`;
  document.getElementById('btn-back-to-board')?.addEventListener('click', () => loadProject(currentProjectId));
  document.getElementById('btn-detail-back')?.addEventListener('click', () => loadProject(currentProjectId));
  document.getElementById('btn-edit-task')?.addEventListener('click', () => showEditTaskModal(task));
  document.getElementById('btn-delete-task')?.addEventListener('click', () => deleteTask(task.id));
}

function showEditTaskModal(task) {
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="edit-title">
      <div class="modal__header">
        <h2 class="modal__title" id="edit-title">Edit Task</h2>
        <button class="modal__close" aria-label="Close dialog" data-action="close-modal">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button>
      </div>
      <form id="edit-task-form">
        <div class="form-group" style="margin-bottom:var(--space-3)">
          <label class="form-group__label" for="edit-title-input">Title</label>
          <input class="input" type="text" id="edit-title-input" required value="${escHtml(task.title)}" maxlength="200">
        </div>
        <div class="form-group" style="margin-bottom:var(--space-3)">
          <label class="form-group__label" for="edit-desc-input">Description</label>
          <textarea class="input" id="edit-desc-input" rows="3" maxlength="1000">${escHtml(task.description || '')}</textarea>
        </div>
        <div class="form-row" style="margin-bottom:var(--space-3)">
          <div class="form-group">
            <label class="form-group__label" for="edit-label">Label</label>
            <select class="select" id="edit-label">
              <option value="">None</option>
              <option value="Feature" ${task.labels?.includes('Feature') ? 'selected' : ''}>Feature</option>
              <option value="Bug" ${task.labels?.includes('Bug') ? 'selected' : ''}>Bug</option>
              <option value="Enhancement" ${task.labels?.includes('Enhancement') ? 'selected' : ''}>Enhancement</option>
              <option value="Urgent" ${task.labels?.includes('Urgent') ? 'selected' : ''}>Urgent</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-group__label" for="edit-completed">Status</label>
            <select class="select" id="edit-completed">
              <option value="false" ${!task.isCompleted ? 'selected' : ''}>In Progress</option>
              <option value="true" ${task.isCompleted ? 'selected' : ''}>Completed</option>
            </select>
          </div>
        </div>
      </form>
      <div class="task-edit-form__actions modal__footer">
        <button class="btn btn--secondary" data-action="close-modal">Cancel</button>
        <button class="btn btn--primary" id="btn-save-task-edit" data-task-id="${task.id}">Save Changes</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  requestAnimationFrame(() => modal.classList.add('is-active'));

  modal.querySelector('.modal-backdrop').addEventListener('click', (e) => { if (e.target === modal.querySelector('.modal-backdrop')) closeModal(); });
  modal.querySelectorAll('[data-action="close-modal"]').forEach(btn => btn.addEventListener('click', closeModal));

  setTimeout(() => document.getElementById('edit-title-input')?.focus(), 50);

  document.getElementById('btn-save-task-edit')?.addEventListener('click', async () => {
    const title = document.getElementById('edit-title-input').value.trim();
    if (!title) {
      document.getElementById('edit-title-input').classList.add('input--error');
      document.getElementById('edit-title-input').focus();
      toast('Title is required', 'error');
      return;
    }
    const desc = document.getElementById('edit-desc-input').value.trim();
    const label = document.getElementById('edit-label').value || undefined;
    const completed = document.getElementById('edit-completed').value === 'true';
    const saveBtn = document.getElementById('btn-save-task-edit');
    setBtnLoading(saveBtn, true);
    try {
      await api(`/projects/${currentProjectId}/tasks/${task.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ title, description: desc, isCompleted: completed, label, columnId: task.columnId }),
      });
      toast('Task updated', 'success');
      closeModal();
      await loadProject(currentProjectId);
    } catch (err) {
      toast('Failed to update task: ' + err.message, 'error');
    } finally {
      setBtnLoading(saveBtn, false);
    }
  });

  document.getElementById('edit-title-input')?.addEventListener('input', function () {
    if (this.classList.contains('input--error')) this.classList.remove('input--error');
  });
}

async function deleteTask(taskId) {
  const btn = document.getElementById('btn-delete-task');
  if (btn) setBtnLoading(btn, true);
  try {
    await api(`/projects/${currentProjectId}/tasks/${taskId}`, { method: 'DELETE' });
    toast('Task deleted', 'success');
    closeModal();
    await loadProject(currentProjectId);
  } catch (err) {
    toast('Failed to delete task: ' + err.message, 'error');
  } finally {
    if (btn) setBtnLoading(btn, false);
  }
}

async function showCreateTaskModal(columnId) {
  try {
    const data = await api(`/projects/${currentProjectId}`);
    const project = data.project;
    window._currentProject = project;
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div class="modal__header">
          <h2 class="modal__title" id="modal-title">Create Task</h2>
          <button class="modal__close" aria-label="Close dialog" data-action="close-modal">
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          </button>
        </div>
        <form id="create-task-form">
          <div class="form-group" style="margin-bottom:var(--space-3)">
            <label class="form-group__label" for="task-title">Title</label>
            <input class="input" type="text" id="task-title" required placeholder="Enter task title" maxlength="200">
          </div>
          <div class="form-group" style="margin-bottom:var(--space-3)">
            <label class="form-group__label" for="task-desc">Description</label>
            <textarea class="input" id="task-desc" rows="3" placeholder="Enter task description" maxlength="1000"></textarea>
          </div>
          <div class="form-row" style="margin-bottom:var(--space-3)">
            <div class="form-group">
              <label class="form-group__label" for="task-label">Label</label>
              <select class="select" id="task-label">
                <option value="">None</option>
                <option value="Feature">Feature</option>
                <option value="Bug">Bug</option>
                <option value="Enhancement">Enhancement</option>
                <option value="Urgent">Urgent</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-group__label" for="task-column">Column</label>
              <select class="select" id="task-column"></select>
            </div>
          </div>
        </form>
        <div class="modal__footer">
          <button class="btn btn--secondary" data-action="close-modal">Cancel</button>
          <button class="btn btn--primary" id="btn-create-task">Create Task</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    requestAnimationFrame(() => modal.classList.add('is-active'));

    modal.querySelector('.modal-backdrop').addEventListener('click', (e) => { if (e.target === modal.querySelector('.modal-backdrop')) closeModal(); });
    modal.querySelectorAll('[data-action="close-modal"]').forEach(btn => btn.addEventListener('click', closeModal));

    const cols = project.columnConfig || [];
    const select = document.getElementById('task-column');
    select.innerHTML = cols.map((c, i) => `<option value="${c.id}" ${i === 0 || c.id === columnId ? 'selected' : ''}>${escHtml(c.name)}</option>`).join('');

    setTimeout(() => document.getElementById('task-title')?.focus(), 50);

    document.getElementById('task-title')?.addEventListener('input', function () {
      if (this.classList.contains('input--error')) this.classList.remove('input--error');
    });

    document.getElementById('btn-create-task')?.addEventListener('click', async () => {
      const title = document.getElementById('task-title').value.trim();
      if (!title) {
        document.getElementById('task-title').classList.add('input--error');
        document.getElementById('task-title').focus();
        toast('Title is required', 'error');
        return;
      }
      const desc = document.getElementById('task-desc').value.trim();
      const label = document.getElementById('task-label').value || undefined;
      const col = document.getElementById('task-column').value;
      const createBtn = document.getElementById('btn-create-task');
      setBtnLoading(createBtn, true);
      try {
        await api(`/projects/${currentProjectId}/tasks`, {
          method: 'POST',
          body: JSON.stringify({ title, description: desc, columnId: col, label }),
        });
        toast('Task created', 'success');
        closeModal();
        await loadProject(currentProjectId);
      } catch (err) {
        toast('Failed to create task: ' + err.message, 'error');
      } finally {
        setBtnLoading(createBtn, false);
      }
    });
  } catch (err) {
    toast('Failed to load project: ' + err.message, 'error');
  }
}

function showSettingsModal() {
  const project = window._currentProject;
  if (!project) return;
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  const currentDensity = document.documentElement.getAttribute('data-density') || 'comfortable';
  modal.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <div class="modal__header">
        <h2 class="modal__title" id="settings-title">Project Settings</h2>
        <button class="modal__close" aria-label="Close dialog" data-action="close-modal">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button>
      </div>
      <div class="settings">
        <div class="settings__section">
          <h3 class="settings__section-title">Project Details</h3>
          <div class="form-group" style="margin-bottom:var(--space-3)">
            <label class="form-group__label" for="proj-name">Project Name</label>
            <input class="input" type="text" id="proj-name" value="${escHtml(project.name)}" maxlength="100">
          </div>
          <div class="form-group">
            <label class="form-group__label" for="proj-desc">Description</label>
            <textarea class="input" id="proj-desc" rows="2" maxlength="500">${escHtml(project.description || '')}</textarea>
          </div>
        </div>
        <div class="settings__section">
          <h3 class="settings__section-title">Density</h3>
          <div style="display:flex;gap:var(--space-2)" role="radiogroup" aria-label="Density mode">
            <button class="btn btn--secondary btn--sm density-btn" data-density="compact" role="radio" aria-checked="${currentDensity === 'compact'}">Compact</button>
            <button class="btn btn--primary btn--sm density-btn" data-density="comfortable" role="radio" aria-checked="${currentDensity === 'comfortable'}">Comfortable</button>
            <button class="btn btn--secondary btn--sm density-btn" data-density="relaxed" role="radio" aria-checked="${currentDensity === 'relaxed'}">Relaxed</button>
          </div>
        </div>
      </div>
      <div class="modal__footer">
        <button class="btn btn--secondary" data-action="close-modal">Close</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  requestAnimationFrame(() => modal.classList.add('is-active'));

  modal.querySelector('.modal-backdrop').addEventListener('click', (e) => { if (e.target === modal.querySelector('.modal-backdrop')) closeModal(); });
  modal.querySelectorAll('[data-action="close-modal"]').forEach(btn => btn.addEventListener('click', closeModal));

  modal.querySelectorAll('.density-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.documentElement.setAttribute('data-density', btn.dataset.density);
      localStorage.setItem('teamtask-density', btn.dataset.density);
      modal.querySelectorAll('.density-btn').forEach(b => b.setAttribute('aria-checked', 'false'));
      btn.setAttribute('aria-checked', 'true');
      btn.classList.remove('btn--secondary');
      btn.classList.add('btn--primary');
      modal.querySelectorAll('.density-btn').forEach(b => {
        if (b !== btn) { b.classList.remove('btn--primary'); b.classList.add('btn--secondary'); }
      });
      toast(`Density set to ${btn.dataset.density}`, 'success');
    });
  });
}

function showInviteModal() {
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="invite-title">
      <div class="modal__header">
        <h2 class="modal__title" id="invite-title">Invite Members</h2>
        <button class="modal__close" aria-label="Close dialog" data-action="close-modal">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button>
      </div>
      <div style="margin-bottom:var(--space-3)">
        <p style="color:var(--color-muted-text);font-size:var(--font-size-body);margin:0">Add members by email. They'll be invited to this project.</p>
      </div>
      <div class="invite__email-row">
        <input class="input" type="email" id="invite-email" placeholder="member@example.com" aria-label="Email address">
        <button class="btn btn--primary" id="btn-invite-send">Send Invite</button>
      </div>
      <ul class="invite__list" id="invite-list" aria-label="Invited members"></ul>
      <div class="modal__footer">
        <button class="btn btn--secondary" data-action="close-modal">Close</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  requestAnimationFrame(() => modal.classList.add('is-active'));

  modal.querySelector('.modal-backdrop').addEventListener('click', (e) => { if (e.target === modal.querySelector('.modal-backdrop')) closeModal(); });
  modal.querySelectorAll('[data-action="close-modal"]').forEach(btn => btn.addEventListener('click', closeModal));

  document.getElementById('btn-invite-send')?.addEventListener('click', inviteMember);
  document.getElementById('invite-email')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') inviteMember(); });
}

async function inviteMember() {
  const email = document.getElementById('invite-email')?.value.trim();
  if (!email || !email.includes('@')) {
    toast('Please enter a valid email address', 'error');
    document.getElementById('invite-email')?.focus();
    return;
  }
  const list = document.getElementById('invite-list');
  const li = document.createElement('li');
  li.className = 'invite__item';
  li.innerHTML = `
    <div class="invite__item-info">
      <div class="avatar avatar--sm">${escHtml(email[0].toUpperCase())}</div>
      <div>
        <div class="invite__item-name">${escHtml(email)}</div>
        <div class="invite__item-email">${escHtml(email)}</div>
      </div>
    </div>
    <span class="badge badge--info invite__item-status">Pending</span>`;
  list.appendChild(li);
  document.getElementById('invite-email').value = '';
  toast(`Invite sent to ${email}`, 'success');
}

function closeModal() {
  const modal = document.querySelector('.modal-backdrop.is-active');
  if (modal) {
    modal.classList.remove('is-active');
    setTimeout(() => modal.remove(), 220);
    _modalFocusTrap = null;
  }
}

function openSidebar() {
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (!sidebar) return;
  sidebar.classList.add('is-open');
  if (backdrop) backdrop.classList.add('is-active');
  _sidebarOpen = true;
  document.getElementById('btn-menu')?.setAttribute('aria-expanded', 'true');
  setTimeout(() => sidebar.querySelector('.sidebar__item')?.focus(), 100);
}

function closeSidebar() {
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (!sidebar) return;
  sidebar.classList.remove('is-open');
  if (backdrop) backdrop.classList.remove('is-active');
  _sidebarOpen = false;
  document.getElementById('btn-menu')?.setAttribute('aria-expanded', 'false');
}

function detectLayout() {
  if (window.innerWidth >= 768) closeSidebar();
}

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  const density = localStorage.getItem('teamtask-density') || 'comfortable';
  document.documentElement.setAttribute('data-density', density);

  const btnMenu = document.getElementById('btn-menu');
  if (btnMenu) {
    btnMenu.addEventListener('click', () => {
      if (_sidebarOpen) closeSidebar(); else openSidebar();
    });
  }

  const backdrop = document.getElementById('sidebar-backdrop');
  if (backdrop) {
    backdrop.addEventListener('click', closeSidebar);
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const activeModal = document.querySelector('.modal-backdrop.is-active');
      if (activeModal) {
        closeModal();
      } else if (_sidebarOpen) {
        closeSidebar();
      }
    }
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.task-card__move-menu')) {
      document.querySelectorAll('.task-card__move-menu').forEach(m => m.style.display = 'none');
    }
  });

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      detectLayout();
      if (currentProjectId) {
        api(`/projects/${currentProjectId}`).then(data => {
          if (data && data.project) {
            const board = document.getElementById('page-content');
            if (board) renderBoard(data.project);
          }
        }).catch(() => {});
      }
    }, 150);
  });

  loadProjects();
});