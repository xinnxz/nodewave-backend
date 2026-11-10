import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { authMiddleware, requireRole } from '../middlewares/auth';
import { createProjectSchema, updateProjectSchema } from '../validators/project.validator';
import * as projectService from '../services/project.service';
import type { JwtPayload } from '../lib/jwt';

/**
 * Project Routes
 *
 * Semua endpoint di sini memerlukan autentikasi (authMiddleware).
 * Endpoint yang membuat/mengubah/menghapus proyek dibatasi hanya untuk PM.
 */

const projects = new Hono();

// Semua route di bawah ini memerlukan autentikasi
projects.use('*', authMiddleware);

// GET /api/projects — List semua proyek (scoped by role)
projects.get('/', async (c) => {
  const user = c.get('user') as JwtPayload;
  const queryParams = c.req.query();
  const result = await projectService.listProjects(user, queryParams);
  return c.json({ success: true, ...result });
});

// POST /api/projects — Buat proyek baru (PM only)
projects.post('/', requireRole(['PM']), async (c) => {
  const body = await c.req.json();
  const parsed = createProjectSchema.safeParse(body);

  if (!parsed.success) {
    throw new HTTPException(400, {
      message: `Validation error: ${parsed.error.errors.map((e) => e.message).join(', ')}`,
    });
  }

  const project = await projectService.createProject(parsed.data);
  return c.json({ success: true, data: project }, 201);
});

// GET /api/projects/:id — Detail proyek
projects.get('/:id', async (c) => {
  const user = c.get('user') as JwtPayload;
  const projectId = c.req.param('id')!;

  try {
    const project = await projectService.getProjectById(projectId, user);
    return c.json({ success: true, data: project });
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

// PATCH /api/projects/:id — Update proyek (PM only)
projects.patch('/:id', requireRole(['PM']), async (c) => {
  const projectId = c.req.param('id')!;
  const body = await c.req.json();
  const parsed = updateProjectSchema.safeParse(body);

  if (!parsed.success) {
    throw new HTTPException(400, {
      message: `Validation error: ${parsed.error.errors.map((e) => e.message).join(', ')}`,
    });
  }

  try {
    const project = await projectService.updateProject(projectId, parsed.data);
    return c.json({ success: true, data: project });
  } catch (err: any) {
    if (err.message.includes('not found')) {
      throw new HTTPException(404, { message: err.message });
    }
    throw err;
  }
});

// DELETE /api/projects/:id — Soft delete proyek (PM only)
projects.delete('/:id', requireRole(['PM']), async (c) => {
  const projectId = c.req.param('id')!;

  try {
    await projectService.deleteProject(projectId);
    return c.json({ success: true, message: 'Project deleted successfully' });
  } catch (err: any) {
    if (err.message.includes('not found')) {
      throw new HTTPException(404, { message: err.message });
    }
    throw err;
  }
});

export default projects;
