import { prisma } from './prisma';
import type { Task } from '@prisma/client';

/**
 * Audit Trail Helper — Change Data Capture (CDC)
 *
 * Setiap kali field pada Task berubah, fungsi ini mencatat perubahan
 * ke tabel AuditLog secara immutable (append-only, tidak pernah di-UPDATE/DELETE).
 *
 * Ini memenuhi requirement brief:
 * > "Every change to any field within a Task (status change, description change,
 * >  assignee change) must be recorded immutably in a separate Log table,
 * >  including: User ID, Timestamp, Changed Column, Old Value, New Value."
 *
 * Cara kerja:
 * 1. Sebelum update, baca state lama (before)
 * 2. Bandingkan field-by-field dengan data baru (changes)
 * 3. Untuk setiap field yang berubah, INSERT satu baris ke AuditLog
 *
 * Field yang di-exclude dari audit: version, updatedAt (internal bookkeeping)
 */

const EXCLUDED_FIELDS = ['version', 'updatedAt', 'createdAt'];

export async function recordAuditTrail(
  taskId: string,
  userId: string,
  before: Record<string, unknown>,
  changes: Record<string, unknown>
): Promise<void> {
  const auditEntries: Array<{
    taskId: string;
    userId: string;
    changedColumn: string;
    oldValue: string | null;
    newValue: string | null;
  }> = [];

  for (const [key, newValue] of Object.entries(changes)) {
    if (EXCLUDED_FIELDS.includes(key)) continue;
    if (newValue === undefined) continue;

    const oldValue = before[key];

    // Hanya catat jika nilainya benar-benar berubah
    if (String(oldValue ?? '') !== String(newValue ?? '')) {
      auditEntries.push({
        taskId,
        userId,
        changedColumn: key,
        oldValue: oldValue != null ? String(oldValue) : null,
        newValue: newValue != null ? String(newValue) : null,
      });
    }
  }

  if (auditEntries.length > 0) {
    await prisma.auditLog.createMany({ data: auditEntries });
  }
}
