import type { Context, Next } from 'hono';
import { HTTPException } from 'hono/http-exception';

/**
 * Global Error Handler Middleware
 *
 * Mengapa perlu error handler global?
 * - Tanpa ini, error yang tidak ditangkap akan menampilkan stack trace mentah
 *   ke client (kebocoran informasi internal — risiko keamanan).
 * - Middleware ini menangkap semua error, memformat response JSON yang konsisten,
 *   dan menyembunyikan detail internal di production.
 *
 * Format response error yang konsisten:
 * {
 *   "success": false,
 *   "error": {
 *     "code": 400,
 *     "message": "Validation failed: ..."
 *   }
 * }
 */
export function errorHandler(err: Error, c: Context) {
  console.error(`[ERROR] ${err.message}`, err.stack);

  if (err instanceof HTTPException) {
    return c.json(
      {
        success: false,
        error: {
          code: err.status,
          message: err.message,
        },
      },
      err.status
    );
  }

  // Error tak terduga — jangan bocorkan detail ke client
  const statusCode = 500;
  return c.json(
    {
      success: false,
      error: {
        code: statusCode,
        message:
          process.env.NODE_ENV === 'development'
            ? err.message
            : 'Internal Server Error',
      },
    },
    statusCode
  );
}
