import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { authMiddleware, requireRole } from '../middlewares/auth';
import {
  createTaskSchema,
  updateTaskSchema,
  updateTaskStatusSchema,
  addDependencySchema,
  createAttachmentSchema,
} from '../validators/task.validator';
import * as taskService from '../services/task.service';
import * as dependencyService from '../services/dependency.service';
import * as auditService from '../services/audit.service';
import type { JwtPayload } from '../lib/jwt';

/**
 * Task Routes
 *
 * Ini adalah route layer terbesar karena menangani:
 * - CRUD tugas (scoped by role)
 * - Status transitions (dengan ABAC + dependency check)
 * - Task dependencies (dengan circular detection)
 * - Audit log viewer
 * - Daily standup summary
 */

const tasks = new Hono();

// Semua route memerlukan autentikasi
tasks.use('*', authMiddleware);

// ============================================================
// TASK CRUD
// ============================================================

// GET /api/projects/:projectId/tasks — List tugas dalam proyek
tasks.get('/projects/:projectId/tasks', async (c) => {
  const user = c.get('user') as JwtPayload;
  const projectId = c.req.param('projectId');
  const queryParams = c.req.query();

  try {
    const result = await taskService.listTasks(projectId, user, queryParams);
    return c.json({ success: true, ...result });
  } catch (err: any) {
    if (err.message.includes('not found')) {
      throw new HTTPException(404, { message: err.message });
    }
    if (err.message.includes('Access denied')) {
      throw new HTTPException(403, { message: err.message });
    }
    throw err;
  }
});

// POST /api/projects/:projectId/tasks — Buat tugas baru (PM only)
tasks.post('/projects/:projectId/tasks', requireRole(['PM']), async (c) => {
  const user = c.get('user') as JwtPayload;
  const projectId = c.req.param('projectId');
  const body = await c.req.json();
  const parsed = createTaskSchema.safeParse(body);

  if (!parsed.success) {
    throw new HTTPException(400, {
      message: `Validation error: ${parsed.error.errors.map((e) => e.message).join(', ')}`,
    });
  }

  try {
    const task = await taskService.createTask(projectId, parsed.data, user);
    return c.json({ success: true, data: task }, 201);
  } catch (err: any) {
    if (err.message.includes('not found')) {
      throw new HTTPException(404, { message: err.message });
    }
    throw err;
  }
});

// GET /api/tasks/:id — Detail tugas
tasks.get('/tasks/:id', async (c) => {
  const user = c.get('user') as JwtPayload;
  const taskId = c.req.param('id');

  try {
    const task = await taskService.getTaskById(taskId, user);
    return c.json({ success: true, data: task });
  } catch (err: any) {
    if (err.message.includes('not found')) {
      throw new HTTPException(404, { message: err.message });
    }
    if (err.message.includes('Access denied')) {
      throw new HTTPException(403, { message: err.message });
    }
    throw err;
  }
});

// PATCH /api/tasks/:id — Update field tugas (PM only + optimistic locking)
tasks.patch('/tasks/:id', requireRole(['PM']), async (c) => {
  const user = c.get('user') as JwtPayload;
  const taskId = c.req.param('id');
  const body = await c.req.json();
  const parsed = updateTaskSchema.safeParse(body);

  if (!parsed.success) {
    throw new HTTPException(400, {
      message: `Validation error: ${parsed.error.errors.map((e) => e.message).join(', ')}`,
    });
  }

  try {
    const task = await taskService.updateTask(taskId, parsed.data, user);
    return c.json({ success: true, data: task });
  } catch (err: any) {
    if ((err as any).statusCode === 409) {
      throw new HTTPException(409, { message: err.message });
    }
    if (err.message.includes('not found')) {
      throw new HTTPException(404, { message: err.message });
    }
    throw err;
  }
});

// PATCH /api/tasks/:id/status — Ubah status tugas (ABAC + deps + locking)
tasks.patch('/tasks/:id/status', async (c) => {
  const user = c.get('user') as JwtPayload;
  const taskId = c.req.param('id');
  const body = await c.req.json();
  const parsed = updateTaskStatusSchema.safeParse(body);

  if (!parsed.success) {
    throw new HTTPException(400, {
      message: `Validation error: ${parsed.error.errors.map((e) => e.message).join(', ')}`,
    });
  }

  // Client Guest tidak boleh mengubah status
  if (user.role === 'CLIENT_GUEST') {
    throw new HTTPException(403, {
      message: 'Access denied: Client Guests cannot modify task status.',
    });
  }

  try {
    const task = await taskService.updateTaskStatus(taskId, parsed.data, user);
    return c.json({ success: true, data: task });
  } catch (err: any) {
    const statusCode = (err as any).statusCode;
    if (statusCode === 409) {
      throw new HTTPException(409, { message: err.message });
    }
    if (statusCode === 403) {
      throw new HTTPException(403, { message: err.message });
    }
    if (statusCode === 400) {
      throw new HTTPException(400, { message: err.message });
    }
    if (err.message.includes('not found')) {
      throw new HTTPException(404, { message: err.message });
    }
    throw err;
  }
});

// DELETE /api/tasks/:id — Soft delete tugas (PM only)
tasks.delete('/tasks/:id', requireRole(['PM']), async (c) => {
  const user = c.get('user') as JwtPayload;
  const taskId = c.req.param('id');

  try {
    await taskService.deleteTask(taskId, user);
    return c.json({ success: true, message: 'Task deleted successfully' });
  } catch (err: any) {
    if (err.message.includes('not found')) {
      throw new HTTPException(404, { message: err.message });
    }
    throw err;
  }
});

// ============================================================
// TASK DEPENDENCIES
// ============================================================

// POST /api/tasks/:id/dependencies — Tambah dependensi (PM only)
tasks.post('/tasks/:id/dependencies', requireRole(['PM']), async (c) => {
  const user = c.get('user') as JwtPayload;
  const taskId = c.req.param('id');
  const body = await c.req.json();
  const parsed = addDependencySchema.safeParse(body);

  if (!parsed.success) {
    throw new HTTPException(400, {
      message: `Validation error: ${parsed.error.errors.map((e) => e.message).join(', ')}`,
    });
  }

  try {
    const dep = await dependencyService.addDependency(
      taskId,
      parsed.data.prerequisiteId,
      user
    );
    return c.json({ success: true, data: dep }, 201);
  } catch (err: any) {
    if (err.message.includes('circular')) {
      throw new HTTPException(400, { message: err.message });
    }
    if (err.message.includes('not found')) {
      throw new HTTPException(404, { message: err.message });
    }
    if (err.message.includes('already exists')) {
      throw new HTTPException(409, { message: err.message });
    }
    throw err;
  }
});

// GET /api/tasks/:id/dependencies — List dependensi tugas
tasks.get('/tasks/:id/dependencies', async (c) => {
  const taskId = c.req.param('id');

  try {
    const deps = await dependencyService.getTaskDependencies(taskId);
    return c.json({ success: true, data: deps });
  } catch (err: any) {
    if (err.message.includes('not found')) {
      throw new HTTPException(404, { message: err.message });
    }
    throw err;
  }
});

// DELETE /api/tasks/:taskId/dependencies/:depId — Hapus dependensi (PM only)
tasks.delete(
  '/tasks/:taskId/dependencies/:depId',
  requireRole(['PM']),
  async (c) => {
    const taskId = c.req.param('taskId');
    const depId = c.req.param('depId');

    try {
      const result = await dependencyService.removeDependency(taskId, depId);
      return c.json({ success: true, ...result });
    } catch (err: any) {
      if (err.message.includes('not found')) {
        throw new HTTPException(404, { message: err.message });
      }
      throw err;
    }
  }
);

// ============================================================
// ATTACHMENTS
// ============================================================

// POST /api/tasks/:id/attachments — Upload lampiran kerja (PM & Assigned Executor)
tasks.post(
  '/tasks/:id/attachments',
  requireRole(['PM', 'INTERNAL_MEMBER']),
  async (c) => {
    const user = c.get('user') as JwtPayload;
    const taskId = c.req.param('id');
    const body = await c.req.json();
    const parsed = createAttachmentSchema.safeParse(body);

    if (!parsed.success) {
      throw new HTTPException(400, {
        message: `Validation error: ${parsed.error.errors.map((e) => e.message).join(', ')}`,
      });
    }

    try {
      const attachment = await taskService.addAttachment(taskId, parsed.data, user);
      return c.json({ success: true, data: attachment }, 201);
    } catch (err: any) {
      if (err.statusCode === 403) {
        throw new HTTPException(403, { message: err.message });
      }
      if (err.message.includes('not found')) {
        throw new HTTPException(404, { message: err.message });
      }
      throw err;
    }
  }
);

// GET /api/tasks/:id/attachments — List lampiran tugas
tasks.get('/tasks/:id/attachments', async (c) => {
  const user = c.get('user') as JwtPayload;
  const taskId = c.req.param('id');

  try {
    const attachments = await taskService.getTaskAttachments(taskId, user);
    return c.json({ success: true, data: attachments });
  } catch (err: any) {
    if (err.message.includes('not found')) {
      throw new HTTPException(404, { message: err.message });
    }
    if (err.message.includes('Access denied')) {
      throw new HTTPException(403, { message: err.message });
    }
    throw err;
  }
});

// ============================================================
// AUDIT LOGS
// ============================================================

// GET /api/tasks/:id/audit-logs — Riwayat perubahan tugas (PM & Internal Member)
tasks.get(
  '/tasks/:id/audit-logs',
  requireRole(['PM', 'INTERNAL_MEMBER']),
  async (c) => {
    const taskId = c.req.param('id');

    try {
      const logs = await auditService.getTaskAuditLogs(taskId);
      return c.json({ success: true, data: logs });
    } catch (err: any) {
      if (err.message.includes('not found')) {
        throw new HTTPException(404, { message: err.message });
      }
      throw err;
    }
  }
);

// GET /api/projects/:id/daily-summary — Daily standup summary (PM only, Bonus)
tasks.get('/projects/:id/daily-summary', requireRole(['PM']), async (c) => {
  const projectId = c.req.param('id');

  try {
    const summary = await auditService.getDailyStandupSummary(projectId);
    return c.json({ success: true, data: summary });
  } catch (err: any) {
    if (err.message.includes('not found')) {
      throw new HTTPException(404, { message: err.message });
    }
    throw err;
  }
});

export default tasks;
