import { z } from 'zod';

export const createTaskSchema = z.object({
  title: z
    .string({ required_error: 'Task title is required' })
    .min(2, 'Task title must be at least 2 characters'),
  description: z
    .string({ required_error: 'Task description is required' })
    .min(2, 'Description must be at least 2 characters'),
  department: z.enum(['PRODUCT', 'UIUX', 'FRONTEND', 'BACKEND'], {
    required_error: 'Department is required',
  }),
  assigneeId: z.string().uuid().optional(),
  isClientVisible: z.boolean().optional().default(false),
});

/**
 * Update Task Schema
 *
 * Catatan penting tentang `version`:
 * - Field `version` WAJIB disertakan di setiap request update.
 * - Ini adalah bagian dari mekanisme Optimistic Locking (FR-002 di PRD).
 * - Backend akan mencocokkan version ini dengan version di database.
 * - Jika tidak cocok (karena user lain sudah mengubah data), backend
 *   mengembalikan 409 Conflict.
 */
export const updateTaskSchema = z.object({
  title: z.string().min(2).optional(),
  description: z.string().min(2).optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  isClientVisible: z.boolean().optional(),
  version: z.number().int().positive('Version must be a positive integer'),
});

export const updateTaskStatusSchema = z.object({
  status: z.enum(['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE'], {
    required_error: 'Status is required',
  }),
  version: z.number().int().positive('Version must be a positive integer'),
});

export const addDependencySchema = z.object({
  prerequisiteId: z
    .string({ required_error: 'Prerequisite task ID is required' })
    .uuid('Invalid task ID format'),
});

export const createAttachmentSchema = z.object({
  filename: z
    .string({ required_error: 'Filename is required' })
    .min(1, 'Filename cannot be empty'),
  fileUrl: z
    .string({ required_error: 'File URL is required' })
    .url('File URL must be a valid URL'),
  fileSize: z.number().int().positive().optional(),
  mimeType: z.string().optional(),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type UpdateTaskStatusInput = z.infer<typeof updateTaskStatusSchema>;
export type AddDependencyInput = z.infer<typeof addDependencySchema>;
export type CreateAttachmentInput = z.infer<typeof createAttachmentSchema>;
