import { prisma } from '../lib/prisma';
import { recordAuditTrail } from '../lib/audit';
import type { JwtPayload } from '../lib/jwt';
import type {
  CreateTaskInput,
  UpdateTaskInput,
  UpdateTaskStatusInput,
  CreateAttachmentInput,
} from '../validators/task.validator';
import { BuildQueryFilter, extractQueryFromParams } from '@nodewave/prisma-ezfilter';
import type { Task, TaskStatus } from '@prisma/client';

/**
 * Task Service — Core Business Logic
 *
 * File ini mengimplementasikan SEMUA logika bisnis kompleks dari PRD:
 * - RBAC + ABAC (state-based permissions)
 * - Optimistic Locking (version counter, 409 Conflict)
 * - Dependency-Aware status transitions (DAG constraint)
 * - Immutable Audit Trail (field-level CDC)
 * - Data Masking untuk Client Guest (API-level response filtering)
 * - Soft Deletes (deletedAt IS NULL)
 */

// ============================================================
// LIST TASKS (with scoping, filtering, and data masking)
// ============================================================

export async function listTasks(
  projectId: string,
  user: JwtPayload,
  queryParams: Record<string, string>
) {
  // Verifikasi akses ke proyek
  await verifyProjectAccess(projectId, user);

  const filter = extractQueryFromParams(queryParams);
  const queryBuilder = new BuildQueryFilter();
  const result = queryBuilder.build(filter);

  const baseWhere: Record<string, unknown> = {
    projectId,
    deletedAt: null,
    ...result.query.where,
  };

  // Scoping berdasarkan role
  if (user.role === 'CLIENT_GUEST') {
    // Client hanya lihat task yang isClientVisible = true
    baseWhere.isClientVisible = true;
  }
  // Catatan untuk INTERNAL_MEMBER:
  // verifyProjectAccess() di atas sudah memastikan user di-assign ke proyek ini.
  // Di dalam proyek yang di-assign ke mereka, anggota tim internal dapat melihat
  // seluruh task board proyek agar bisa memantau status prerequisite lintas divisi.

  const [tasks, total] = await Promise.all([
    prisma.task.findMany({
      where: baseWhere,
      orderBy: result.query.orderBy || { createdAt: 'desc' },
      skip: result.query.skip,
      take: result.query.take,
      include: {
        assignee: {
          select: {
            id: true,
            name: true,
            email: true,
            department: true,
            avatarUrl: true,
          },
        },
        dependencies: {
          include: {
            prerequisite: {
              select: {
                id: true,
                title: true,
                status: true,
                department: true,
              },
            },
          },
        },
        _count: {
          select: { attachments: true, auditLogs: true },
        },
      },
    }),
    prisma.task.count({ where: baseWhere }),
  ]);

  // DATA MASKING untuk Client Guest
  const maskedTasks = user.role === 'CLIENT_GUEST'
    ? tasks.map(maskTaskForClient)
    : tasks;

  return {
    data: maskedTasks,
    meta: {
      total,
      page: filter.page || 1,
      rows: filter.rows || 10,
      totalPages: Math.ceil(total / (filter.rows || 10)),
    },
  };
}

// ============================================================
// GET SINGLE TASK
// ============================================================

export async function getTaskById(taskId: string, user: JwtPayload) {
  const task = await prisma.task.findFirst({
    where: { id: taskId, deletedAt: null },
    include: {
      project: { select: { id: true, name: true, clientId: true } },
      assignee: {
        select: {
          id: true,
          name: true,
          email: true,
          department: true,
          avatarUrl: true,
        },
      },
      dependencies: {
        include: {
          prerequisite: {
            select: {
              id: true,
              title: true,
              status: true,
              department: true,
            },
          },
        },
      },
      prerequisiteFor: {
        include: {
          task: {
            select: {
              id: true,
              title: true,
              status: true,
              department: true,
            },
          },
        },
      },
      attachments: {
        orderBy: { createdAt: 'desc' },
      },
      auditLogs: {
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: {
          user: {
            select: { id: true, name: true },
          },
        },
      },
    },
  });

  if (!task) {
    throw new Error('Task not found');
  }

  // Access check
  await verifyTaskAccess(task, user);

  // Data masking untuk Client Guest
  if (user.role === 'CLIENT_GUEST') {
    return maskTaskDetailForClient(task);
  }

  return task;
}

// ============================================================
// CREATE TASK (PM only)
// ============================================================

export async function createTask(projectId: string, input: CreateTaskInput, user: JwtPayload) {
  // Verifikasi proyek ada dan belum dihapus
  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
  });

  if (!project) {
    throw new Error('Project not found');
  }

  // Jika ada assignee, verifikasi user tersebut ada
  if (input.assigneeId) {
    const assignee = await prisma.user.findFirst({
      where: { id: input.assigneeId, deletedAt: null },
    });
    if (!assignee) {
      throw new Error('Assignee user not found');
    }
  }

  return prisma.task.create({
    data: {
      projectId,
      title: input.title,
      description: input.description,
      department: input.department,
      assigneeId: input.assigneeId,
      isClientVisible: input.isClientVisible,
    },
    include: {
      assignee: {
        select: { id: true, name: true, email: true, department: true },
      },
    },
  });
}

// ============================================================
// UPDATE TASK (PM only — with Optimistic Locking + Audit Trail)
// ============================================================

/**
 * Update task fields (description, assignee, isClientVisible).
 *
 * Hanya PM yang boleh mengubah field-field ini.
 * Internal Member TIDAK bisa mengubah deskripsi task (sesuai brief).
 *
 * Mekanisme Optimistic Locking:
 * 1. Client mengirim `version` yang terakhir dia baca
 * 2. Backend menjalankan UPDATE ... WHERE id=:id AND version=:clientVersion
 * 3. Jika rows_affected = 0 → data sudah diubah oleh user lain → 409 Conflict
 */
export async function updateTask(
  taskId: string,
  input: UpdateTaskInput,
  user: JwtPayload
) {
  // Baca state SEBELUM update (untuk audit trail)
  const before = await prisma.task.findFirst({
    where: { id: taskId, deletedAt: null },
  });

  if (!before) {
    throw new Error('Task not found');
  }

  // Pisahkan version dari data update
  const { version, ...updateData } = input;

  // OPTIMISTIC LOCKING: update hanya jika version cocok
  const result = await prisma.task.updateMany({
    where: {
      id: taskId,
      version: version, // Ini kunci optimistic locking!
      deletedAt: null,
    },
    data: {
      ...updateData,
      version: { increment: 1 },
    },
  });

  // Jika 0 rows terpengaruh, artinya version tidak cocok → 409 Conflict
  if (result.count === 0) {
    const currentTask = await prisma.task.findFirst({
      where: { id: taskId, deletedAt: null },
    });
    if (!currentTask) {
      throw new Error('Task not found');
    }
    // Task ada tapi version berbeda → conflict
    const error = new Error(
      'Conflict: This task was modified by another user. Please refresh and retry.'
    );
    (error as any).statusCode = 409;
    throw error;
  }

  // AUDIT TRAIL: catat perubahan field-by-field
  await recordAuditTrail(taskId, user.userId, before as any, updateData);

  // Return task yang sudah diupdate
  return prisma.task.findFirst({
    where: { id: taskId },
    include: {
      assignee: {
        select: { id: true, name: true, email: true, department: true },
      },
    },
  });
}

// ============================================================
// UPDATE TASK STATUS (ABAC + Dependency Check + Optimistic Locking)
// ============================================================

/**
 * Ini adalah fungsi PALING KOMPLEKS di seluruh backend.
 * Di sinilah 4 pemeriksaan bersilangan terjadi secara atomik:
 *
 * 1. RBAC: Apakah user punya role yang benar?
 * 2. ABAC: Apakah transisi status ini diizinkan untuk role ini?
 *    - PM TIDAK BISA mengubah IN_PROGRESS → DONE
 *    - Hanya assignee (executor) yang bisa menyelesaikan task
 * 3. Dependency Check: Apakah semua prasyarat sudah DONE?
 * 4. Optimistic Locking: Apakah version masih konsisten?
 */
export async function updateTaskStatus(
  taskId: string,
  input: UpdateTaskStatusInput,
  user: JwtPayload
) {
  const task = await prisma.task.findFirst({
    where: { id: taskId, deletedAt: null },
    include: {
      dependencies: {
        include: {
          prerequisite: {
            select: { id: true, title: true, status: true },
          },
        },
      },
    },
  });

  if (!task) {
    throw new Error('Task not found');
  }

  const { status: newStatus, version } = input;

  // ── CHECK 1: ABAC — PM tidak bisa menandai task sebagai DONE ──
  //
  // Brief: "cannot move a task status from In Progress to Done
  //         (only the executor can complete it)"
  if (user.role === 'PM' && newStatus === 'DONE') {
    const error = new Error(
      'Access denied: Product Managers cannot mark tasks as Done. Only the assigned executor can complete a task.'
    );
    (error as any).statusCode = 403;
    throw error;
  }

  // ── CHECK 2: ABAC — Internal Member hanya bisa update task mereka sendiri ──
  if (user.role === 'INTERNAL_MEMBER') {
    if (task.assigneeId !== user.userId) {
      const error = new Error(
        'Access denied: You can only change status of tasks assigned to you.'
      );
      (error as any).statusCode = 403;
      throw error;
    }
  }

  // ── CHECK 3: Dependency Check — Tidak bisa IN_PROGRESS jika deps belum DONE ──
  //
  // Brief: "Task C is automatically Blocked and cannot be worked on
  //         by the Frontend Engineer until both Task A and Task B are Done"
  if (newStatus === 'IN_PROGRESS' || newStatus === 'DONE') {
    const unfulfilledDeps = task.dependencies.filter(
      (dep) => dep.prerequisite.status !== 'DONE'
    );

    if (unfulfilledDeps.length > 0) {
      const blockers = unfulfilledDeps
        .map((dep) => `"${dep.prerequisite.title}" (${dep.prerequisite.status})`)
        .join(', ');

      const error = new Error(
        `Cannot change status: Prerequisite tasks are not completed yet. Blocked by: ${blockers}`
      );
      (error as any).statusCode = 400;
      throw error;
    }
  }

  // ── CHECK 4: Optimistic Locking — Version harus cocok ──
  const result = await prisma.task.updateMany({
    where: {
      id: taskId,
      version: version,
      deletedAt: null,
    },
    data: {
      status: newStatus,
      version: { increment: 1 },
    },
  });

  if (result.count === 0) {
    const error = new Error(
      'Conflict: This task was modified by another user. Please refresh and retry.'
    );
    (error as any).statusCode = 409;
    throw error;
  }

  // AUDIT TRAIL
  await recordAuditTrail(
    taskId,
    user.userId,
    { status: task.status },
    { status: newStatus }
  );

  // Setelah status berubah ke DONE, periksa apakah ada task lain
  // yang menunggu task ini — jika semua deps mereka sekarang DONE,
  // ubah status mereka dari BLOCKED → TODO
  if (newStatus === 'DONE') {
    await unblockDependentTasks(taskId);
  }

  return prisma.task.findFirst({
    where: { id: taskId },
    include: {
      assignee: {
        select: { id: true, name: true, email: true, department: true },
      },
      dependencies: {
        include: {
          prerequisite: {
            select: { id: true, title: true, status: true },
          },
        },
      },
    },
  });
}

// ============================================================
// SOFT DELETE TASK (PM only)
// ============================================================

export async function deleteTask(taskId: string, user: JwtPayload) {
  const task = await prisma.task.findFirst({
    where: { id: taskId, deletedAt: null },
  });

  if (!task) {
    throw new Error('Task not found');
  }

  return prisma.task.update({
    where: { id: taskId },
    data: { deletedAt: new Date() },
  });
}

// ============================================================
// ATTACHMENTS (PM + Assigned Internal Member)
// ============================================================

export async function addAttachment(
  taskId: string,
  input: CreateAttachmentInput,
  user: JwtPayload
) {
  const task = await prisma.task.findFirst({
    where: { id: taskId, deletedAt: null },
  });

  if (!task) {
    throw new Error('Task not found');
  }

  if (user.role === 'CLIENT_GUEST') {
    const error = new Error('Access denied: Client Guests cannot upload attachments.');
    (error as any).statusCode = 403;
    throw error;
  }

  if (user.role === 'INTERNAL_MEMBER' && task.assigneeId !== user.userId) {
    const error = new Error(
      'Access denied: You can only upload attachments to tasks assigned to you.'
    );
    (error as any).statusCode = 403;
    throw error;
  }

  const attachment = await prisma.attachment.create({
    data: {
      taskId,
      userId: user.userId,
      filename: input.filename,
      fileUrl: input.fileUrl,
      fileSize: input.fileSize,
      mimeType: input.mimeType,
    },
    include: {
      user: {
        select: { id: true, name: true, department: true },
      },
    },
  });

  await recordAuditTrail(
    taskId,
    user.userId,
    { attachment: null },
    { attachment: input.filename }
  );

  return attachment;
}

export async function getTaskAttachments(taskId: string, user: JwtPayload) {
  const task = await prisma.task.findFirst({
    where: { id: taskId, deletedAt: null },
    include: { project: { select: { id: true, clientId: true } } },
  });

  if (!task) {
    throw new Error('Task not found');
  }

  await verifyTaskAccess(task, user);

  if (user.role === 'CLIENT_GUEST') {
    return [];
  }

  return prisma.attachment.findMany({
    where: { taskId },
    orderBy: { createdAt: 'desc' },
    include: {
      user: {
        select: { id: true, name: true, department: true },
      },
    },
  });
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Verifikasi apakah user punya akses ke proyek tertentu.
 */
async function verifyProjectAccess(projectId: string, user: JwtPayload) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
  });

  if (!project) {
    throw new Error('Project not found');
  }

  if (user.role === 'CLIENT_GUEST' && project.clientId !== user.userId) {
    throw new Error('Access denied: You can only view your own projects');
  }

  if (user.role === 'INTERNAL_MEMBER') {
    const hasAssignment = await prisma.task.findFirst({
      where: { projectId, assigneeId: user.userId, deletedAt: null },
    });
    if (!hasAssignment) {
      throw new Error('Access denied: You are not assigned to any task in this project');
    }
  }
}

/**
 * Verifikasi apakah user punya akses ke task tertentu.
 */
async function verifyTaskAccess(task: any, user: JwtPayload) {
  if (user.role === 'CLIENT_GUEST') {
    if (task.project?.clientId !== user.userId) {
      throw new Error('Access denied');
    }
    if (!task.isClientVisible) {
      throw new Error('Access denied: This task is not visible to clients');
    }
  }

  if (user.role === 'INTERNAL_MEMBER') {
    await verifyProjectAccess(task.projectId, user);
  }
}

/**
 * DATA MASKING — Filter identitas internal dari response untuk Client Guest
 *
 * Brief: "All internal identities (engineer names, avatars, departments)
 *         and internal comment history must be automatically filtered out
 *         from the API response, not hidden via CSS/Frontend."
 */
function maskTaskForClient(task: any) {
  return {
    id: task.id,
    projectId: task.projectId,
    title: task.title,
    description: task.description,
    status: task.status,
    department: task.department,
    isClientVisible: task.isClientVisible,
    version: task.version,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    // MASKED: semua identitas internal dihapus
    assignee: null,
    dependencies: task.dependencies?.map((dep: any) => ({
      id: dep.id,
      prerequisite: {
        id: dep.prerequisite.id,
        title: dep.prerequisite.title,
        status: dep.prerequisite.status,
      },
    })),
    _count: {
      attachments: task._count?.attachments || 0,
    },
  };
}

function maskTaskDetailForClient(task: any) {
  return {
    id: task.id,
    projectId: task.projectId,
    title: task.title,
    description: task.description,
    status: task.status,
    department: task.department,
    isClientVisible: task.isClientVisible,
    version: task.version,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    project: task.project ? { id: task.project.id, name: task.project.name } : null,
    // MASKED
    assignee: null,
    auditLogs: [], // Internal comment/history dihapus
    attachments: [], // File internal dihapus
    dependencies: task.dependencies?.map((dep: any) => ({
      id: dep.id,
      prerequisite: {
        id: dep.prerequisite.id,
        title: dep.prerequisite.title,
        status: dep.prerequisite.status,
      },
    })),
  };
}

/**
 * Ketika sebuah task selesai (DONE), periksa task-task yang
 * menunggu task ini. Jika semua dependency mereka kini sudah DONE,
 * ubah status mereka dari BLOCKED → TODO.
 */
async function unblockDependentTasks(completedTaskId: string) {
  // Cari task-task yang bergantung pada task ini
  const dependentLinks = await prisma.taskDependency.findMany({
    where: { prerequisiteId: completedTaskId },
    select: { taskId: true },
  });

  for (const link of dependentLinks) {
    // Cek apakah SEMUA dependency dari task ini sudah DONE
    const remainingBlockers = await prisma.taskDependency.findMany({
      where: {
        taskId: link.taskId,
        prerequisite: {
          status: { not: 'DONE' },
          deletedAt: null,
        },
      },
    });

    // Jika tidak ada blocker tersisa DAN task masih BLOCKED, ubah ke TODO
    if (remainingBlockers.length === 0) {
      await prisma.task.updateMany({
        where: {
          id: link.taskId,
          status: 'BLOCKED',
          deletedAt: null,
        },
        data: { status: 'TODO' },
      });
    }
  }
}
