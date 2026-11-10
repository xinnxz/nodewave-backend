import { PrismaClient } from '@prisma/client';

/**
 * Prisma Client Singleton
 * 
 * Mengapa pakai singleton?
 * - Bun (seperti Node.js) melakukan hot-reload saat development.
 * - Tanpa singleton, setiap reload membuat koneksi database baru.
 * - Ini akan menghabiskan connection pool PostgreSQL dan menyebabkan error
 *   "Too many connections" dalam hitungan menit.
 * 
 * Solusi: simpan instance di globalThis agar tetap persist antar-reload.
 */

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
