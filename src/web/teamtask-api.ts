/**
 * TeamTask API - Product data endpoints for the TeamTask application.
 * Simple in-memory store for product data.
 */

import express from 'express';

interface ColumnConfig {
  id: string;
  name: string;
  order: number;
  wipLimit: number | null;
}

interface TeamTaskProject {
  id: string;
  name: string;
  description: string;
  columnConfig: ColumnConfig[];
  memberIds: string[];
  createdAt: string;
  updatedAt: string;
}

interface TeamTaskTask {
  id: string;
  title: string;
  description: string;
  columnId: string;
  assigneeId: string | null;
  dueDate: string | null;
  points: number;
  order: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  isCompleted: boolean;
  label: string | undefined;
}

const DEFAULT_COLUMNS: ColumnConfig[] = [
  { id: 'backlog', name: 'Backlog', order: 0, wipLimit: 10 },
  { id: 'todo', name: 'To Do', order: 1, wipLimit: 8 },
  { id: 'in-progress', name: 'In Progress', order: 2, wipLimit: 5 },
  { id: 'in-review', name: 'In Review', order: 3, wipLimit: 3 },
  { id: 'done', name: 'Done', order: 4, wipLimit: null },
];

const teamtaskProjects = new Map<string, TeamTaskProject>();
const teamtaskTasks = new Map<string, TeamTaskTask>();
let projectIdCounter = 0;
let taskIdCounter = 0;

function generateProjectId(): string {
  projectIdCounter++;
  return `teamtask-project-${projectIdCounter}`;
}

function generateTaskId(): string {
  taskIdCounter++;
  return `teamtask-task-${taskIdCounter}`;
}

function createDefaultProject(name: string, description: string): TeamTaskProject {
  const now = new Date().toISOString();
  return {
    id: generateProjectId(),
    name,
    description,
    columnConfig: [...DEFAULT_COLUMNS],
    memberIds: [],
    createdAt: now,
    updatedAt: now,
  };
}

/** Register TeamTask product API endpoints */
export function registerTeamtaskApi(app: express.Express): void {
  // Seed a default project
  const defaultProject = {
    id: generateProjectId(),
    name: 'TeamTask Demo',
    description: 'A lightweight task tracker for small teams.',
    columnConfig: [...DEFAULT_COLUMNS],
    memberIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  teamtaskProjects.set(defaultProject.id, defaultProject);

  // Projects
  app.get('/api/teamtask/projects', (_req, res) => {
    const projects = Array.from(teamtaskProjects.values());
    res.json({ count: projects.length, projects });
  });

  app.post('/api/teamtask/projects', (req, res) => {
    const { name, description } = req.body as { name?: string; description?: string };
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      res.status(400).json({ error: 'Project name is required' });
      return;
    }
    const now = new Date().toISOString();
    const project: TeamTaskProject = {
      id: generateProjectId(),
      name: name.trim(),
      description: description?.trim() ?? '',
      columnConfig: [...DEFAULT_COLUMNS],
      memberIds: [],
      createdAt: now,
      updatedAt: now,
    };
    teamtaskProjects.set(project.id, project);
    res.status(201).json(project);
  });

  app.get('/api/teamtask/projects/:id', (req, res) => {
    const project = teamtaskProjects.get(req.params['id']!);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const tasks = Array.from(teamtaskTasks.values()).sort((a, b) => a.order - b.order);
    res.json({ project: { ...project, tasks } });
  });

  app.patch('/api/teamtask/projects/:id', (req, res) => {
    const project = teamtaskProjects.get(req.params['id']!);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const { name, description, columnConfig } = req.body as {
      name?: string;
      description?: string;
      columnConfig?: typeof DEFAULT_COLUMNS;
    };
    const updated: TeamTaskProject = {
      ...project,
      name: name?.trim() ?? project.name,
      description: description?.trim() ?? project.description,
      columnConfig: columnConfig ?? project.columnConfig,
      updatedAt: new Date().toISOString(),
    };
    teamtaskProjects.set(project.id, updated);
    res.json(updated);
  });

  app.delete('/api/teamtask/projects/:id', (req, res) => {
    if (!teamtaskProjects.has(req.params['id']!)) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    teamtaskProjects.delete(req.params['id']!);
    res.status(204).end();
  });

  // Tasks
  app.get('/api/teamtask/projects/:projectId/tasks', (req, res) => {
    const projectId = req.params['projectId']!;
    if (!teamtaskProjects.has(projectId)) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    // For simplicity, return all tasks (in a real app, filter by projectId)
    const tasks = Array.from(teamtaskTasks.values())
      .sort((a, b) => a.order - b.order);
    res.json({ count: tasks.length, tasks });
  });

  app.post('/api/teamtask/projects/:projectId/tasks', (req, res) => {
    const projectId = req.params['projectId']!;
    if (!teamtaskProjects.has(projectId)) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const project = teamtaskProjects.get(projectId)!;
    const { title, description, assigneeId, dueDate, points, columnId, label } = req.body as {
      title?: string;
      description?: string;
      assigneeId?: string | null;
      dueDate?: string | null;
      points?: number;
      columnId?: string;
      label?: string;
    };
    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      res.status(400).json({ error: 'Task title is required' });
      return;
    }
    const targetColumnId = columnId ?? project.columnConfig[0]?.id ?? 'backlog';

    // Get max order in target column
    const columnTasks = Array.from(teamtaskTasks.values())
      .filter((t) => t.columnId === targetColumnId)
      .sort((a, b) => a.order - b.order);
    const maxOrder = columnTasks.length > 0 ? Math.max(...columnTasks.map((t) => t.order)) : 0;

    const now = new Date().toISOString();
    const task: TeamTaskTask = {
      id: generateTaskId(),
      title: title.trim(),
      description: description?.trim() ?? '',
      columnId: targetColumnId,
      assigneeId: assigneeId ?? null,
      dueDate: dueDate ?? null,
      points: typeof points === 'number' ? points : 3,
      order: maxOrder + 1,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      isCompleted: false,
      label,
    };
    teamtaskTasks.set(task.id, task);
    res.status(201).json(task);
  });

  app.get('/api/teamtask/projects/:projectId/tasks/:taskId', (req, res) => {
    const task = teamtaskTasks.get(req.params['taskId']!);
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    res.json(task);
  });

  app.patch('/api/teamtask/projects/:projectId/tasks/:taskId', (req, res) => {
    const task = teamtaskTasks.get(req.params['taskId']!);
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    const { title, description, assigneeId, dueDate, points, columnId, order, isCompleted, label } = req.body as {
      title?: string;
      description?: string;
      assigneeId?: string | null;
      dueDate?: string | null;
      points?: number;
      columnId?: string;
      order?: number;
      isCompleted?: boolean;
      label?: string;
    };
    const now = new Date().toISOString();
    const newColumnId = columnId !== undefined ? columnId : task.columnId;
    const completedAt = (isCompleted === true || newColumnId === 'done') && task.columnId !== 'done' && task.completedAt === null
      ? now
      : (isCompleted === false ? null : task.completedAt);
    const updated: TeamTaskTask = {
      ...task,
      title: title?.trim() ?? task.title,
      description: description?.trim() ?? task.description,
      assigneeId: assigneeId !== undefined ? assigneeId : task.assigneeId,
      dueDate: dueDate !== undefined ? dueDate : task.dueDate,
      points: typeof points === 'number' ? points : task.points,
      columnId: newColumnId,
      order: typeof order === 'number' ? order : task.order,
      updatedAt: now,
      completedAt,
      isCompleted: isCompleted !== undefined ? isCompleted : task.isCompleted,
      label: label !== undefined ? label : task.label,
    };
    teamtaskTasks.set(task.id, updated);
    res.json(updated);
  });

  app.delete('/api/teamtask/projects/:projectId/tasks/:taskId', (req, res) => {
    if (!teamtaskTasks.has(req.params['taskId']!)) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    teamtaskTasks.delete(req.params['taskId']!);
    res.status(204).end();
  });

  // Move task (drag & drop)
  app.post('/api/teamtask/projects/:projectId/tasks/:taskId/move', (req, res) => {
    const task = teamtaskTasks.get(req.params['taskId']!);
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    const { columnId, order } = req.body as { columnId: string; order: number };
    if (!columnId || typeof order !== 'number') {
      res.status(400).json({ error: 'columnId and order are required' });
      return;
    }

    // Reorder tasks in target column
    const columnTasks = Array.from(teamtaskTasks.values())
      .filter((t) => t.columnId === columnId && t.id !== req.params['taskId'])
      .sort((a, b) => a.order - b.order);

    // Shift orders to make room
    for (let i = order; i < columnTasks.length; i++) {
      const t = columnTasks[i];
      if (t) {
        teamtaskTasks.set(t.id, { ...t, order: i + 1, updatedAt: new Date().toISOString() });
      }
    }

    // Update the moved task
    const now = new Date().toISOString();
    const completedAt = columnId === 'done' && task.columnId !== 'done' ? now : task.completedAt;
    const updated: TeamTaskTask = {
      ...task,
      columnId,
      order,
      updatedAt: now,
      completedAt,
    };
    teamtaskTasks.set(task.id, updated);

    res.json(updated);
  });

  // Columns
  app.get('/api/teamtask/projects/:projectId/columns', (req, res) => {
    const project = teamtaskProjects.get(req.params['projectId']!);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    res.json({ count: project.columnConfig.length, columns: project.columnConfig });
  });

  app.patch('/api/teamtask/projects/:projectId/columns/:columnId', (req, res) => {
    const project = teamtaskProjects.get(req.params['projectId']!);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const { name, wipLimit, order } = req.body as { name?: string; wipLimit?: number | null; order?: number };
    const columns = [...project.columnConfig];
    const idx = columns.findIndex((c) => c.id === req.params['columnId']);
    if (idx === -1) {
      res.status(404).json({ error: 'Column not found' });
      return;
    }
    const existingColumn = columns[idx]!;
    columns[idx] = {
      ...existingColumn,
      name: name?.trim() ?? existingColumn.name,
      wipLimit: wipLimit !== undefined ? wipLimit : existingColumn.wipLimit,
      order: typeof order === 'number' ? order : existingColumn.order,
    };
    columns.sort((a, b) => a.order - b.order);
    columns.forEach((c, i) => { c.order = i; });

    const updated = { ...project, columnConfig: columns, updatedAt: new Date().toISOString() };
    teamtaskProjects.set(project.id, updated);
    teamtaskProjects.set(project.id, updated);
    res.json({ count: columns.length, columns });
  });

  app.post('/api/teamtask/projects/:projectId/columns', (req, res) => {
    const project = teamtaskProjects.get(req.params['projectId']!);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const { name, wipLimit } = req.body as { name?: string; wipLimit?: number | null };
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      res.status(400).json({ error: 'Column name is required' });
      return;
    }
    const columns = [...project.columnConfig];
    const newColumn: ColumnConfig = {
      id: `col-${Date.now()}`,
      name: name.trim(),
      order: columns.length,
      wipLimit: typeof wipLimit === 'number' ? wipLimit : null,
    };
    columns.push(newColumn);

    const updated = { ...project, columnConfig: columns, updatedAt: new Date().toISOString() };
    teamtaskProjects.set(project.id, updated);
    res.status(201).json(newColumn);
  });

  app.delete('/api/teamtask/projects/:projectId/columns/:columnId', (req, res) => {
    const project = teamtaskProjects.get(req.params['projectId']!);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const columns = [...project.columnConfig];
    const idx = columns.findIndex((c) => c.id === req.params['columnId']);
    if (idx === -1) {
      res.status(404).json({ error: 'Column not found' });
      return;
    }
    if (columns.length <= 1) {
      res.status(400).json({ error: 'Cannot delete the last column' });
      return;
    }
    const deletedColumn = columns[idx]!;
    const targetColumn = columns[0]!;
    const deletedColumnId = deletedColumn.id;
    const targetColumnId = targetColumn.id;

    // Move tasks from deleted column to first column
    for (const [id, task] of teamtaskTasks.entries()) {
      if (task.columnId === deletedColumnId) {
        teamtaskTasks.set(id, { ...task, columnId: targetColumnId, order: 0, updatedAt: new Date().toISOString() });
      }
    }
    // Reorder remaining tasks in target column
    const targetTasks = Array.from(teamtaskTasks.values())
      .filter((t) => t.columnId === targetColumnId)
      .sort((a, b) => a.order - b.order);
    targetTasks.forEach((t, i) => {
      teamtaskTasks.set(t.id, { ...t, order: i, updatedAt: new Date().toISOString() });
    });

    columns.splice(idx, 1);
    columns.forEach((c, i) => { c.order = i; });

    const updated = { ...project, columnConfig: columns, updatedAt: new Date().toISOString() };
    teamtaskProjects.set(project.id, updated);
    res.json({ count: columns.length, columns });
  });
}