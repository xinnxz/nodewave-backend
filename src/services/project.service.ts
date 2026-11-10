import { prisma } from '../lib/prisma';
import { type JwtPayload } from '../lib/jwt';
import type { CreateProjectInput, UpdateProjectInput } from '../validators/project.validator';
import { BuildQueryFilter, extractQueryFromParams } from '@nodewave/prisma-ezfilter';

/**
 * Project Service
 *
 * Aturan akses proyek berdasarkan role (dari PRD §3):
 * - PM: Bisa baca semua proyek, buat, edit, soft-delete
 * - INTERNAL_MEMBER: Hanya bisa baca proyek yang ada task-nya yang di-assign ke mereka
 * - CLIENT_GUEST: Hanya bisa baca proyek miliknya sendiri (clientId match)
 */

export async function listProjects(user: JwtPayload, queryParams: Record<string, string>) {
  // Build dynamic query dari query params menggunakan @nodewave/prisma-ezfilter
  const filter = extractQueryFromParams(queryParams);
  const queryBuilder = new BuildQueryFilter();
  const result = queryBuilder.build(filter);

  // Base filter: hanya tampilkan yang belum di-soft-delete
  const baseWhere: Record<string, unknown> = {
    deletedAt: null,
    ...result.query.where,
  };

  // Scoping berdasarkan role
  if (user.role === 'CLIENT_GUEST') {
    // Client Guest hanya lihat proyek yang dia jadi client-nya
    baseWhere.clientId = user.userId;
  } else if (user.role === 'INTERNAL_MEMBER') {
    // Internal Member hanya lihat proyek yang ada task yang di-assign ke mereka
    baseWhere.tasks = {
      some: {
        assigneeId: user.userId,
        deletedAt: null,
      },
    };
  }
  // PM: tidak ada filter tambahan (lihat semua)

  const [projects, total] = await Promise.all([
    prisma.project.findMany({
      where: baseWhere,
      orderBy: result.query.orderBy || { createdAt: 'desc' },
      skip: result.query.skip,
      take: result.query.take,
      include: {
        _count: {
          select: { tasks: { where: { deletedAt: null } } },
        },
        tasks: {
          where: { deletedAt: null },
          select: { status: true },
        },
      },
    }),
    prisma.project.count({ where: baseWhere }),
  ]);

  // Tambahkan metrik agregat per proyek
  const projectsWithMetrics = projects.map((project) => {
    const totalTasks = project.tasks.length;
    const doneTasks = project.tasks.filter((t) => t.status === 'DONE').length;
    const progress = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

    const { tasks, ...rest } = project;
    return {
      ...rest,
      metrics: {
        totalTasks,
        doneTasks,
        progress: `${progress}%`,
      },
    };
  });

  return {
    data: projectsWithMetrics,
    meta: {
      total,
      page: filter.page || 1,
      rows: filter.rows || 10,
      totalPages: Math.ceil(total / (filter.rows || 10)),
    },
  };
}

export async function getProjectById(projectId: string, user: JwtPayload) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
    include: {
      client: {
        select: { id: true, name: true, email: true },
      },
      tasks: {
        where: { deletedAt: null },
        select: { id: true, status: true, department: true },
      },
    },
  });

  if (!project) {
    throw new Error('Project not found');
  }

  // Access check
  if (user.role === 'CLIENT_GUEST' && project.clientId !== user.userId) {
    throw new Error('Access denied: You can only view your own projects');
  }

  if (user.role === 'INTERNAL_MEMBER') {
    const hasAssignedTask = await prisma.task.findFirst({
      where: { projectId, assigneeId: user.userId, deletedAt: null },
    });
    if (!hasAssignedTask) {
      throw new Error('Access denied: You are not assigned to any task in this project');
    }
  }

  // Hitung metrik
  const totalTasks = project.tasks.length;
  const doneTasks = project.tasks.filter((t) => t.status === 'DONE').length;
  const progress = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

  const statusBreakdown = {
    TODO: project.tasks.filter((t) => t.status === 'TODO').length,
    IN_PROGRESS: project.tasks.filter((t) => t.status === 'IN_PROGRESS').length,
    BLOCKED: project.tasks.filter((t) => t.status === 'BLOCKED').length,
    DONE: doneTasks,
  };

  const { tasks, ...rest } = project;
  return {
    ...rest,
    metrics: {
      totalTasks,
      doneTasks,
      progress: `${progress}%`,
      statusBreakdown,
    },
  };
}

export async function createProject(input: CreateProjectInput) {
  return prisma.project.create({
    data: {
      name: input.name,
      description: input.description,
      clientName: input.clientName,
      clientId: input.clientId,
    },
  });
}

export async function updateProject(projectId: string, input: UpdateProjectInput) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
  });

  if (!project) {
    throw new Error('Project not found');
  }

  return prisma.project.update({
    where: { id: projectId },
    data: input,
  });
}

export async function deleteProject(projectId: string) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
  });

  if (!project) {
    throw new Error('Project not found');
  }

  // Soft delete — set deletedAt, jangan hapus dari database
  return prisma.project.update({
    where: { id: projectId },
    data: { deletedAt: new Date() },
  });
}
