import { describe, expect, it } from 'bun:test';
import { signToken, verifyToken } from '../lib/jwt';
import { prisma } from '../lib/prisma';
import * as taskService from '../services/task.service';
import * as dependencyService from '../services/dependency.service';

/**
 * Backend Service & Security Unit Tests
 *
 * Menguji logika inti:
 * 1. JWT Token Signing & Verification
 * 2. ABAC Guard: Product Manager dilarang mengubah status task ke DONE (403)
 * 3. DAG Dependency Guard: Frontend Engineer dilarang memulai task BLOCKED (400)
 * 4. Optimistic Locking: Stale version ditolak dengan 409 Conflict
 * 5. Circular Dependency Detection (DFS): Menolak siklus A -> B -> C -> A
 * 6. Client Guest Data Masking: Menghapus assignee & menyaring isClientVisible
 */

describe('NodeWave Backend Service & Security Suite', () => {
  it('1. should sign and verify JWT payload accurately', () => {
    const payload = {
      userId: 'test-uuid-123',
      email: 'pm@nodewave.id',
      role: 'PM' as const,
      department: 'PRODUCT' as const,
    };

    const token = signToken(payload);
    expect(typeof token).toBe('string');

    const decoded = verifyToken(token);
    expect(decoded).not.toBeNull();
    expect(decoded?.userId).toBe(payload.userId);
    expect(decoded?.role).toBe('PM');
    expect(decoded?.department).toBe('PRODUCT');
  });

  it('2. should reject invalid JWT token gracefully', () => {
    const decoded = verifyToken('invalid.jwt.token');
    expect(decoded).toBeNull();
  });

  it('3. [ABAC] should forbid PM from moving a task status to DONE', async () => {
    const pmUser = await prisma.user.findUniqueOrThrow({
      where: { email: 'pm@nodewave.id' },
    });
    const inProgressTask = await prisma.task.findFirstOrThrow({
      where: { status: 'IN_PROGRESS', deletedAt: null },
    });

    let caughtError: any = null;
    try {
      await taskService.updateTaskStatus(
        inProgressTask.id,
        { status: 'DONE', version: inProgressTask.version },
        {
          userId: pmUser.id,
          email: pmUser.email,
          role: pmUser.role,
          department: pmUser.department,
        }
      );
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).not.toBeNull();
    expect(caughtError.statusCode).toBe(403);
    expect(caughtError.message).toContain('Product Managers cannot mark tasks as Done');
  });

  it('4. [DAG Guard] should block Frontend Engineer from starting a task with unfulfilled prerequisites', async () => {
    const feUser = await prisma.user.findUniqueOrThrow({
      where: { email: 'frontend@nodewave.id' },
    });
    const blockedTask = await prisma.task.findFirstOrThrow({
      where: { status: 'BLOCKED', assigneeId: feUser.id, deletedAt: null },
    });

    let caughtError: any = null;
    try {
      await taskService.updateTaskStatus(
        blockedTask.id,
        { status: 'IN_PROGRESS', version: blockedTask.version },
        {
          userId: feUser.id,
          email: feUser.email,
          role: feUser.role,
          department: feUser.department,
        }
      );
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).not.toBeNull();
    expect(caughtError.statusCode).toBe(400);
    expect(caughtError.message).toContain('Prerequisite tasks are not completed yet');
  });

  it('5. [Optimistic Locking] should throw 409 Conflict when updating with a stale version', async () => {
    const pmUser = await prisma.user.findUniqueOrThrow({
      where: { email: 'pm@nodewave.id' },
    });
    const anyTask = await prisma.task.findFirstOrThrow({
      where: { deletedAt: null },
    });

    let caughtError: any = null;
    try {
      await taskService.updateTask(
        anyTask.id,
        {
          description: 'Attempted concurrent overwrite with stale version',
          version: anyTask.version + 999,
        },
        {
          userId: pmUser.id,
          email: pmUser.email,
          role: pmUser.role,
          department: pmUser.department,
        }
      );
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).not.toBeNull();
    expect(caughtError.statusCode).toBe(409);
    expect(caughtError.message).toContain('Conflict');
  });

  it('6. [DFS Cycle Detection] should reject circular dependencies', async () => {
    const pmUser = await prisma.user.findUniqueOrThrow({
      where: { email: 'pm@nodewave.id' },
    });
    const uiTask = await prisma.task.findFirstOrThrow({
      where: { title: 'Design Homepage UI', deletedAt: null },
    });
    const mobileAuditTask = await prisma.task.findFirstOrThrow({
      where: { title: 'Mobile Responsive Audit', deletedAt: null },
    });

    let caughtError: any = null;
    try {
      await dependencyService.addDependency(uiTask.id, mobileAuditTask.id, {
        userId: pmUser.id,
        email: pmUser.email,
        role: pmUser.role,
        department: pmUser.department,
      });
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).not.toBeNull();
    expect(caughtError.message).toContain('circular dependency');
  });

  it('7. [API Data Masking] should strip internal identities and non-visible tasks for Client Guest', async () => {
    const clientUser = await prisma.user.findUniqueOrThrow({
      where: { email: 'client@guest.com' },
    });
    const project = await prisma.project.findFirstOrThrow({
      where: { clientId: clientUser.id, deletedAt: null },
    });

    const result = await taskService.listTasks(
      project.id,
      {
        userId: clientUser.id,
        email: clientUser.email,
        role: clientUser.role,
        department: clientUser.department,
      },
      {}
    );

    expect(result.data.length).toBeGreaterThan(0);
    for (const task of result.data as any[]) {
      expect(task.isClientVisible).toBe(true);
      expect(task.assignee).toBeNull();
    }
  });
});
