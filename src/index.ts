import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { errorHandler } from './middlewares/error-handler';
import authRoutes from './routes/auth.routes';
import projectRoutes from './routes/project.routes';
import taskRoutes from './routes/task.routes';

/**
 * Main Application Entry Point
 *
 * Arsitektur Hono App:
 * ┌────────────────────────────────────────────────────┐
 * │                    Hono App                         │
 * │                                                     │
 * │  Middleware Chain (dieksekusi berurutan):            │
 * │  1. CORS       → Izinkan request dari frontend      │
 * │  2. Logger     → Log setiap request ke console      │
 * │  3. Routes     → Dispatch ke handler yang sesuai    │
 * │  4. Error Hdlr → Tangkap error, format response     │
 * │                                                     │
 * │  Route Groups:                                      │
 * │  /api/auth/*       → Auth (register, login, me)     │
 * │  /api/projects/*   → Project CRUD                   │
 * │  /api/*            → Tasks, Dependencies, Audits    │
 * └────────────────────────────────────────────────────┘
 */

const app = new Hono();

// ── Global Middleware ──

// CORS: Izinkan frontend (Next.js) mengakses API dari domain berbeda.
// Di production, ganti wildcard '*' dengan URL frontend yang spesifik.
app.use(
  '*',
  cors({
    origin: process.env.FRONTEND_URL || '*',
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    exposeHeaders: ['Content-Length'],
    maxAge: 86400, // Cache preflight request selama 24 jam
    credentials: true,
  })
);

// Logger: Catat setiap request ke console (method, path, status, duration)
app.use('*', logger());

// ── Routes ──

// Health check endpoint — berguna untuk monitoring deployment
app.get('/', (c) =>
  c.json({
    name: 'Nodewave Deliverables Management API',
    version: '1.0.0',
    status: 'running',
    timestamp: new Date().toISOString(),
  })
);

app.get('/api/health', (c) =>
  c.json({ status: 'ok', timestamp: new Date().toISOString() })
);

// Mount route groups
app.route('/api/auth', authRoutes);
app.route('/api/projects', projectRoutes);
app.route('/api', taskRoutes);

// ── Global Error Handler ──
app.onError(errorHandler);

// ── 404 Handler ──
app.notFound((c) =>
  c.json(
    {
      success: false,
      error: {
        code: 404,
        message: `Route not found: ${c.req.method} ${c.req.url}`,
      },
    },
    404
  )
);

// ── Start Server ──
const port = parseInt(process.env.PORT || '4000', 10);

console.log(`
╔══════════════════════════════════════════════════════╗
║   Nodewave Deliverables Management API               ║
║   Running on: http://localhost:${port}                  ║
║   Environment: ${process.env.NODE_ENV || 'development'}                       ║
╚══════════════════════════════════════════════════════╝
`);

export { app };

export default app;
