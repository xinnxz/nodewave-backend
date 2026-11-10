import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { registerSchema, loginSchema } from '../validators/auth.validator';
import * as authService from '../services/auth.service';
import { authMiddleware } from '../middlewares/auth';
import type { JwtPayload } from '../lib/jwt';

/**
 * Auth Routes
 *
 * Endpoint autentikasi — Register, Login, dan Get Profile.
 * Register dan Login TIDAK memerlukan JWT (publik).
 * Get Profile memerlukan JWT (protected).
 */

const auth = new Hono();

// POST /api/auth/register — Registrasi akun baru
auth.post('/register', async (c) => {
  const body = await c.req.json();
  const parsed = registerSchema.safeParse(body);

  if (!parsed.success) {
    throw new HTTPException(400, {
      message: `Validation error: ${parsed.error.errors.map((e) => e.message).join(', ')}`,
    });
  }

  try {
    const result = await authService.registerUser(parsed.data);
    return c.json({ success: true, data: result }, 201);
  } catch (err: any) {
    if (err.message === 'Email already registered') {
      throw new HTTPException(409, { message: err.message });
    }
    throw err;
  }
});

// POST /api/auth/login — Login dan dapatkan JWT token
auth.post('/login', async (c) => {
  const body = await c.req.json();
  const parsed = loginSchema.safeParse(body);

  if (!parsed.success) {
    throw new HTTPException(400, {
      message: `Validation error: ${parsed.error.errors.map((e) => e.message).join(', ')}`,
    });
  }

  try {
    const result = await authService.loginUser(parsed.data);
    return c.json({ success: true, data: result });
  } catch (err: any) {
    if (err.message === 'Invalid email or password') {
      throw new HTTPException(401, { message: err.message });
    }
    throw err;
  }
});

// POST /api/auth/logout — Logout session (protected)
auth.post('/logout', authMiddleware, async (c) => {
  return c.json({
    success: true,
    message: 'Logged out successfully',
  });
});

// GET /api/auth/me — Profil user yang sedang login (protected)
auth.get('/me', authMiddleware, async (c) => {
  const user = c.get('user') as JwtPayload;
  const profile = await authService.getUserProfile(user.userId);
  return c.json({ success: true, data: profile });
});

// GET /api/auth/users — List semua user aktif (untuk dropdown assignment PM)
auth.get('/users', authMiddleware, async (c) => {
  const users = await authService.listUsers();
  return c.json({ success: true, data: users });
});

export default auth;
