import { prisma } from '../lib/prisma';
import type { JwtPayload } from '../lib/jwt';

/**
 * Audit Service — Audit Log Viewer & Daily Standup Summary
 *
 * Service ini menyediakan:
 * 1. Viewer untuk riwayat perubahan per task (immutable log)
 * 2. Daily Standup Auto-Summary (fitur bonus dari PRD §4.4)
 */

export async function getTaskAuditLogs(taskId: string) {
  const task = await prisma.task.findFirst({
    where: { id: taskId, deletedAt: null },
  });

  if (!task) {
    throw new Error('Task not found');
  }

  return prisma.auditLog.findMany({
    where: { taskId },
    orderBy: { createdAt: 'desc' },
    include: {
      user: {
        select: { id: true, name: true, email: true },
      },
    },
  });
}

/**
 * Daily Standup Auto-Summary (Bonus Feature — FR-004)
 *
 * Brief: "The system has a background job or dedicated endpoint that can
 *         summarize all Audit Trail entries from the previous day for a project,
 *         producing structured JSON data containing a summary of 'What was
 *         completed yesterday' and 'What is blocked today' per department."
 *
 * Cara kerja:
 * 1. Query audit logs dari 24 jam terakhir untuk proyek tertentu
 * 2. Filter yang changedColumn = 'status' dan newValue = 'DONE'
 * 3. Kelompokkan per department
 * 4. Query task yang masih BLOCKED hari ini
 * 5. Gabungkan menjadi structured JSON response
 */
export async function getDailyStandupSummary(projectId: string) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
  });

  if (!project) {
    throw new Error('Project not found');
  }

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  // Apa yang diselesaikan kemarin?
  const completedYesterday = await prisma.auditLog.findMany({
    where: {
      task: { projectId, deletedAt: null },
      changedColumn: 'status',
      newValue: 'DONE',
      createdAt: { gte: yesterday },
    },
    include: {
      task: {
        select: { id: true, title: true, department: true },
      },
      user: {
        select: { id: true, name: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  // Apa yang masih blocked hari ini?
  const blockedToday = await prisma.task.findMany({
    where: {
      projectId,
      status: 'BLOCKED',
      deletedAt: null,
    },
    select: {
      id: true,
      title: true,
      department: true,
      assignee: {
        select: { id: true, name: true },
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

  // Kelompokkan per department
  const completedByDept: Record<string, Array<{ taskTitle: string; completedBy: string }>> = {};
  for (const log of completedYesterday) {
    const dept = log.task.department;
    if (!completedByDept[dept]) completedByDept[dept] = [];
    completedByDept[dept].push({
      taskTitle: log.task.title,
      completedBy: log.user.name,
    });
  }

  const blockedByDept: Record<string, Array<{
    taskTitle: string;
    assignee: string | null;
    blockedBy: string[];
  }>> = {};
  for (const task of blockedToday) {
    const dept = task.department;
    if (!blockedByDept[dept]) blockedByDept[dept] = [];
    blockedByDept[dept].push({
      taskTitle: task.title,
      assignee: task.assignee?.name || null,
      blockedBy: task.dependencies
        .filter((d) => d.prerequisite.status !== 'DONE')
        .map((d) => `${d.prerequisite.title} (${d.prerequisite.status})`),
    });
  }

  return {
    projectId,
    projectName: project.name,
    generatedAt: new Date().toISOString(),
    period: {
      from: yesterday.toISOString(),
      to: new Date().toISOString(),
    },
    completedYesterday: {
      total: completedYesterday.length,
      byDepartment: completedByDept,
    },
    blockedToday: {
      total: blockedToday.length,
      byDepartment: blockedByDept,
    },
  };
}
