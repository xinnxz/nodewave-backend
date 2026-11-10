import jwt from 'jsonwebtoken';
import type { Role, Department } from '@prisma/client';

/**
 * JWT Helper Module
 * 
 * JWT (JSON Web Token) adalah standar industri untuk autentikasi stateless.
 * 
 * Cara kerjanya:
 * 1. User login → server membuat token berisi data user (payload)
 * 2. Token ditandatangani dengan SECRET_KEY (hanya server yang tahu)
 * 3. Token dikirim ke client, disimpan di localStorage/cookie
 * 4. Setiap request berikutnya, client mengirim token di header Authorization
 * 5. Server memverifikasi tanda tangan token → jika valid, user terautentikasi
 * 
 * Payload token kita berisi: { userId, email, role, department }
 * Ini memungkinkan middleware RBAC/ABAC membaca role tanpa query ke database.
 */

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-do-not-use-in-production';
const JWT_EXPIRY = '24h';

export interface JwtPayload {
  userId: string;
  email: string;
  role: Role;
  department: Department;
}

/**
 * Membuat JWT token dari data user.
 * Token berlaku selama 24 jam (sesuai standar industri untuk session-based auth).
 */
export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

/**
 * Memverifikasi dan mendekode JWT token.
 * Mengembalikan payload jika token valid, atau null jika tidak.
 */
export function verifyToken(token: string): JwtPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
    return decoded;
  } catch {
    return null;
  }
}
