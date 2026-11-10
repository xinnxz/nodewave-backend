import { z } from 'zod';

export const createProjectSchema = z.object({
  name: z
    .string({ required_error: 'Project name is required' })
    .min(2, 'Project name must be at least 2 characters'),
  description: z.string().optional(),
  clientName: z
    .string({ required_error: 'Client name is required' })
    .min(2, 'Client name must be at least 2 characters'),
  clientId: z.string().uuid().optional(),
});

export const updateProjectSchema = z.object({
  name: z.string().min(2).optional(),
  description: z.string().optional(),
  clientName: z.string().min(2).optional(),
  clientId: z.string().uuid().optional(),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
