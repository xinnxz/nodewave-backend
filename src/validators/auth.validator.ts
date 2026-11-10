import { z } from 'zod';

/**
 * Auth Validators (Zod Schemas)
 *
 * Zod digunakan sebagai schema validator karena:
 * 1. Type-safe — otomatis menghasilkan TypeScript type dari schema
 * 2. Runtime validation — memvalidasi data di runtime (bukan hanya compile-time)
 * 3. Pesan error yang jelas dan bisa dikustomisasi
 * 4. Diminta oleh brief: "Validation: Zod / entity DTOs"
 *
 * Setiap schema mendefinisikan:
 * - Nama field
 * - Tipe data yang diharapkan
 * - Constraint (min length, format email, dll.)
 * - Pesan error kustom
 */

export const registerSchema = z.object({
  email: z
    .string({ required_error: 'Email is required' })
    .email('Invalid email format'),
  password: z
    .string({ required_error: 'Password is required' })
    .min(6, 'Password must be at least 6 characters'),
  name: z
    .string({ required_error: 'Name is required' })
    .min(2, 'Name must be at least 2 characters'),
  role: z.enum(['PM', 'INTERNAL_MEMBER', 'CLIENT_GUEST'], {
    required_error: 'Role is required',
    invalid_type_error: 'Role must be PM, INTERNAL_MEMBER, or CLIENT_GUEST',
  }),
  department: z.enum(['PRODUCT', 'UIUX', 'FRONTEND', 'BACKEND', 'CLIENT'], {
    required_error: 'Department is required',
    invalid_type_error: 'Department must be PRODUCT, UIUX, FRONTEND, BACKEND, or CLIENT',
  }),
  avatarUrl: z.string().url().optional(),
});

export const loginSchema = z.object({
  email: z
    .string({ required_error: 'Email is required' })
    .email('Invalid email format'),
  password: z
    .string({ required_error: 'Password is required' })
    .min(1, 'Password is required'),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
