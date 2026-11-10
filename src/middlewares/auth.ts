import type { Context, Next } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { verifyToken, type JwtPayload } from '../lib/jwt';
import type { Role } from '@prisma/client';

declare module 'hono' {
  interface ContextVariableMap {
    user: JwtPayload;
  }
}

/**
 * Auth Middleware — JWT Verification
 *
 * Cara kerjanya:
 * 1. Baca header Authorization: "Bearer <token>"
 * 2. Ekstrak token dari header
 * 3. Verifikasi signature token menggunakan JWT_SECRET
 * 4. Jika valid, simpan payload user ke Hono context (c.set('user', payload))
 *    sehingga bisa diakses di handler berikutnya via c.get('user')
 * 5. Jika tidak valid, tolak dengan 401 Unauthorized
 *
 * Ini memenuhi requirement:
 * > "guarded/protected routes on both the API and the UI"
 */
export async function authMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new HTTPException(401, {
      message: 'Authentication required. Please provide a valid Bearer token.',
    });
  }

  const token = authHeader.substring(7); // "Bearer " = 7 karakter
  const payload = verifyToken(token);

  if (!payload) {
    throw new HTTPException(401, {
      message: 'Invalid or expired token. Please login again.',
    });
  }

  // Simpan data user ke Hono context — accessible via c.get('user')
  c.set('user', payload);
  await next();
}

/**
 * RBAC Middleware Factory — Role-Based Access Control
 *
 * Membuat middleware yang hanya mengizinkan role tertentu.
 * Digunakan setelah authMiddleware — artinya c.get('user') pasti sudah terisi.
 *
 * Contoh penggunaan:
 *   app.post('/projects', authMiddleware, requireRole(['PM']), createProject)
 *
 * Ini memenuhi requirement:
 * > "User access depends not only on Role (Who are they?)"
 * 
 * @param allowedRoles - Array of roles yang diizinkan mengakses endpoint ini
 */
export function requireRole(allowedRoles: Role[]) {
  return async (c: Context, next: Next) => {
    const user = c.get('user') as JwtPayload;

    if (!user) {
      throw new HTTPException(401, { message: 'Authentication required.' });
    }

    if (!allowedRoles.includes(user.role)) {
      throw new HTTPException(403, {
        message: `Access denied. Required role: ${allowedRoles.join(' or ')}. Your role: ${user.role}.`,
      });
    }

    await next();
  };
}
