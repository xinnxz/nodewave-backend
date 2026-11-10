import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

/**
 * Database Seed Script
 *
 * Script ini membuat data demo yang siap pakai untuk evaluator.
 * Setelah dijalankan, evaluator bisa langsung login dengan akun-akun berikut
 * dan melihat proyek demo lengkap dengan task, dependencies, dan audit logs.
 *
 * Akun Seed (sesuai PRD §7.2):
 * - PM:       pm@nodewave.id       / Password123!
 * - UI/UX:    uiux@nodewave.id     / Password123!
 * - Frontend: frontend@nodewave.id / Password123!
 * - Backend:  backend@nodewave.id  / Password123!
 * - Client:   client@guest.com     / Password123!
 *
 * Jalankan: bun prisma/seed.ts
 */

const prisma = new PrismaClient();
const SEED_PASSWORD = 'Password123!';

async function main() {
  console.log('🌱 Starting database seed...\n');

  // Bersihkan data existing (urutan penting karena foreign key)
  await prisma.auditLog.deleteMany();
  await prisma.attachment.deleteMany();
  await prisma.taskDependency.deleteMany();
  await prisma.task.deleteMany();
  await prisma.project.deleteMany();
  await prisma.user.deleteMany();
  console.log('🗑️  Cleared existing data');

  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10);

  // ════════════════════════════════════════════
  // 1. CREATE USERS
  // ════════════════════════════════════════════

  const pm = await prisma.user.create({
    data: {
      email: 'pm@nodewave.id',
      passwordHash,
      name: 'Andi Pratama',
      role: 'PM',
      department: 'PRODUCT',
      avatarUrl: 'https://api.dicebear.com/9.x/initials/svg?seed=AP',
    },
  });
  console.log(`👤 Created PM: ${pm.email}`);

  const uiux = await prisma.user.create({
    data: {
      email: 'uiux@nodewave.id',
      passwordHash,
      name: 'Sari Dewi',
      role: 'INTERNAL_MEMBER',
      department: 'UIUX',
      avatarUrl: 'https://api.dicebear.com/9.x/initials/svg?seed=SD',
    },
  });
  console.log(`👤 Created UI/UX: ${uiux.email}`);

  const frontend = await prisma.user.create({
    data: {
      email: 'frontend@nodewave.id',
      passwordHash,
      name: 'Budi Santoso',
      role: 'INTERNAL_MEMBER',
      department: 'FRONTEND',
      avatarUrl: 'https://api.dicebear.com/9.x/initials/svg?seed=BS',
    },
  });
  console.log(`👤 Created Frontend: ${frontend.email}`);

  const backend = await prisma.user.create({
    data: {
      email: 'backend@nodewave.id',
      passwordHash,
      name: 'Cahya Wijaya',
      role: 'INTERNAL_MEMBER',
      department: 'BACKEND',
      avatarUrl: 'https://api.dicebear.com/9.x/initials/svg?seed=CW',
    },
  });
  console.log(`👤 Created Backend: ${backend.email}`);

  const client = await prisma.user.create({
    data: {
      email: 'client@guest.com',
      passwordHash,
      name: 'PT Maju Jaya',
      role: 'CLIENT_GUEST',
      department: 'CLIENT',
      avatarUrl: 'https://api.dicebear.com/9.x/initials/svg?seed=MJ',
    },
  });
  console.log(`👤 Created Client: ${client.email}`);

  // ════════════════════════════════════════════
  // 2. CREATE PROJECT
  // ════════════════════════════════════════════

  const project = await prisma.project.create({
    data: {
      name: 'E-Commerce Redesign',
      description:
        'Redesain platform e-commerce PT Maju Jaya untuk meningkatkan konversi penjualan dan pengalaman pengguna. Proyek meliputi redesain UI, refactoring backend API, dan slicing frontend baru.',
      clientName: 'PT Maju Jaya',
      clientId: client.id,
    },
  });
  console.log(`\n📁 Created Project: ${project.name}`);

  // ════════════════════════════════════════════
  // 3. CREATE TASKS (dengan berbagai status)
  // ════════════════════════════════════════════

  // Task 1: UI Design — sudah DONE (prerequisite untuk Task 3)
  const taskUIDesign = await prisma.task.create({
    data: {
      projectId: project.id,
      title: 'Design Homepage UI',
      description:
        'Membuat desain UI homepage baru meliputi hero section, product grid, dan navigation bar. Deliverable: Figma file dengan design system.',
      status: 'DONE',
      department: 'UIUX',
      assigneeId: uiux.id,
      isClientVisible: true,
      version: 3,
    },
  });

  // Task 2: Backend API — sudah DONE (prerequisite untuk Task 3)
  const taskBackendAPI = await prisma.task.create({
    data: {
      projectId: project.id,
      title: 'Build Product Catalog API',
      description:
        'Implementasi REST API untuk product catalog meliputi endpoints: GET /products, GET /products/:id, POST /products, PATCH /products/:id. Termasuk filtering, pagination, dan caching.',
      status: 'DONE',
      department: 'BACKEND',
      assigneeId: backend.id,
      isClientVisible: false,
      version: 5,
    },
  });

  // Task 3: Frontend Slicing — IN_PROGRESS (tergantung Task 1 & 2)
  const taskFESlicing = await prisma.task.create({
    data: {
      projectId: project.id,
      title: 'Frontend Slicing Homepage',
      description:
        'Slicing desain homepage dari Figma ke Next.js 16 components. Integrasi dengan Product Catalog API. Harus responsive dan mengikuti design system.',
      status: 'IN_PROGRESS',
      department: 'FRONTEND',
      assigneeId: frontend.id,
      isClientVisible: true,
      version: 2,
    },
  });

  // Task 4: UI Design Cart — IN_PROGRESS
  const taskUICart = await prisma.task.create({
    data: {
      projectId: project.id,
      title: 'Design Shopping Cart UI',
      description:
        'Desain UI untuk halaman shopping cart: item list, quantity selector, price calculator, dan checkout flow.',
      status: 'IN_PROGRESS',
      department: 'UIUX',
      assigneeId: uiux.id,
      isClientVisible: true,
      version: 1,
    },
  });

  // Task 5: Backend Payment — TODO
  const taskBackendPayment = await prisma.task.create({
    data: {
      projectId: project.id,
      title: 'Build Payment Gateway Integration',
      description:
        'Integrasi dengan Midtrans payment gateway. Implementasi endpoints: POST /checkout, POST /payment/callback, GET /payment/status/:id.',
      status: 'TODO',
      department: 'BACKEND',
      assigneeId: backend.id,
      isClientVisible: false,
      version: 1,
    },
  });

  // Task 6: Frontend Cart Slicing — BLOCKED (tergantung Task 4 & 5)
  const taskFECart = await prisma.task.create({
    data: {
      projectId: project.id,
      title: 'Frontend Slicing Cart & Checkout',
      description:
        'Slicing halaman cart dan checkout flow. Integrasi dengan Payment Gateway API. Termasuk form validation dan error handling.',
      status: 'BLOCKED',
      department: 'FRONTEND',
      assigneeId: frontend.id,
      isClientVisible: true,
      version: 1,
    },
  });

  // Task 7: Backend User Auth — DONE
  const taskBackendAuth = await prisma.task.create({
    data: {
      projectId: project.id,
      title: 'Implement User Authentication',
      description:
        'Implementasi autentikasi JWT: register, login, logout, refresh token. Termasuk middleware guard dan role-based access control.',
      status: 'DONE',
      department: 'BACKEND',
      assigneeId: backend.id,
      isClientVisible: false,
      version: 4,
    },
  });

  // Task 8: UI Mobile Responsive — TODO
  const taskUIMobile = await prisma.task.create({
    data: {
      projectId: project.id,
      title: 'Mobile Responsive Audit',
      description:
        'Audit dan perbaikan tampilan responsive untuk semua halaman di breakpoint 320px, 375px, 768px, dan 1024px.',
      status: 'TODO',
      department: 'UIUX',
      assigneeId: uiux.id,
      isClientVisible: true,
      version: 1,
    },
  });

  console.log('📋 Created 8 tasks with various statuses');

  // ════════════════════════════════════════════
  // 4. CREATE TASK DEPENDENCIES (DAG)
  // ════════════════════════════════════════════

  // Task 3 (FE Slicing Homepage) depends on Task 1 (UI Design) & Task 2 (Backend API)
  await prisma.taskDependency.create({
    data: { taskId: taskFESlicing.id, prerequisiteId: taskUIDesign.id },
  });
  await prisma.taskDependency.create({
    data: { taskId: taskFESlicing.id, prerequisiteId: taskBackendAPI.id },
  });

  // Task 6 (FE Cart) depends on Task 4 (UI Cart) & Task 5 (Backend Payment)
  await prisma.taskDependency.create({
    data: { taskId: taskFECart.id, prerequisiteId: taskUICart.id },
  });
  await prisma.taskDependency.create({
    data: { taskId: taskFECart.id, prerequisiteId: taskBackendPayment.id },
  });

  // Task 8 (Mobile Responsive) depends on Task 3 (FE Homepage sudah jadi)
  await prisma.taskDependency.create({
    data: { taskId: taskUIMobile.id, prerequisiteId: taskFESlicing.id },
  });

  console.log('🔗 Created 5 task dependencies (DAG)');

  // ════════════════════════════════════════════
  // 5. CREATE AUDIT LOG ENTRIES (sample history)
  // ════════════════════════════════════════════

  const now = new Date();
  const yesterday = new Date(now.getTime() - 12 * 60 * 60 * 1000); // 12 jam lalu agar masuk window 24h Daily Standup Summary
  const twoDaysAgo = new Date(now.getTime() - 36 * 60 * 60 * 1000);

  // Riwayat Task 1 (UI Design): TODO → IN_PROGRESS → DONE
  await prisma.auditLog.createMany({
    data: [
      {
        taskId: taskUIDesign.id,
        userId: uiux.id,
        changedColumn: 'status',
        oldValue: 'TODO',
        newValue: 'IN_PROGRESS',
        createdAt: twoDaysAgo,
      },
      {
        taskId: taskUIDesign.id,
        userId: uiux.id,
        changedColumn: 'status',
        oldValue: 'IN_PROGRESS',
        newValue: 'DONE',
        createdAt: yesterday,
      },
    ],
  });

  // Riwayat Task 2 (Backend API): TODO → IN_PROGRESS → DONE
  await prisma.auditLog.createMany({
    data: [
      {
        taskId: taskBackendAPI.id,
        userId: backend.id,
        changedColumn: 'status',
        oldValue: 'TODO',
        newValue: 'IN_PROGRESS',
        createdAt: twoDaysAgo,
      },
      {
        taskId: taskBackendAPI.id,
        userId: pm.id,
        changedColumn: 'description',
        oldValue: 'Build product catalog API',
        newValue: taskBackendAPI.description,
        createdAt: twoDaysAgo,
      },
      {
        taskId: taskBackendAPI.id,
        userId: backend.id,
        changedColumn: 'status',
        oldValue: 'IN_PROGRESS',
        newValue: 'DONE',
        createdAt: yesterday,
      },
    ],
  });

  // Riwayat Task 3 (FE Slicing): BLOCKED → TODO → IN_PROGRESS
  await prisma.auditLog.createMany({
    data: [
      {
        taskId: taskFESlicing.id,
        userId: frontend.id,
        changedColumn: 'status',
        oldValue: 'BLOCKED',
        newValue: 'TODO',
        createdAt: yesterday,
      },
      {
        taskId: taskFESlicing.id,
        userId: frontend.id,
        changedColumn: 'status',
        oldValue: 'TODO',
        newValue: 'IN_PROGRESS',
        createdAt: now,
      },
    ],
  });

  // Riwayat Task 7 (Backend Auth): TODO → IN_PROGRESS → DONE
  await prisma.auditLog.createMany({
    data: [
      {
        taskId: taskBackendAuth.id,
        userId: backend.id,
        changedColumn: 'status',
        oldValue: 'TODO',
        newValue: 'IN_PROGRESS',
        createdAt: twoDaysAgo,
      },
      {
        taskId: taskBackendAuth.id,
        userId: backend.id,
        changedColumn: 'status',
        oldValue: 'IN_PROGRESS',
        newValue: 'DONE',
        createdAt: twoDaysAgo,
      },
    ],
  });

  console.log('📝 Created audit log entries (change history)');

  // ════════════════════════════════════════════
  // 6. CREATE SAMPLE ATTACHMENTS
  // ════════════════════════════════════════════

  await prisma.attachment.createMany({
    data: [
      {
        taskId: taskUIDesign.id,
        userId: uiux.id,
        filename: 'Homepage-Design-System-v2.fig',
        fileUrl: 'https://www.figma.com/file/nodewave-ecommerce-homepage-v2',
        fileSize: 4520000,
        mimeType: 'application/figma',
      },
      {
        taskId: taskBackendAPI.id,
        userId: backend.id,
        filename: 'OpenAPI-Product-Catalog-Spec.json',
        fileUrl: 'https://api.nodewave.id/docs/product-catalog-openapi.json',
        fileSize: 128000,
        mimeType: 'application/json',
      },
    ],
  });
  console.log('📎 Created 2 work attachments');

  // ════════════════════════════════════════════
  // SUMMARY
  // ════════════════════════════════════════════

  const userCount = await prisma.user.count();
  const projectCount = await prisma.project.count();
  const taskCount = await prisma.task.count();
  const depCount = await prisma.taskDependency.count();
  const auditCount = await prisma.auditLog.count();

  console.log(`
╔══════════════════════════════════════════════════════╗
║  ✅ Seed Complete!                                    ║
║                                                       ║
║  Users:        ${String(userCount).padEnd(5)}                               ║
║  Projects:     ${String(projectCount).padEnd(5)}                               ║
║  Tasks:        ${String(taskCount).padEnd(5)}                               ║
║  Dependencies: ${String(depCount).padEnd(5)}                               ║
║  Audit Logs:   ${String(auditCount).padEnd(5)}                               ║
║                                                       ║
║  Login Credentials (all use: Password123!)            ║
║  ─────────────────────────────────────────────        ║
║  PM:       pm@nodewave.id                             ║
║  UI/UX:    uiux@nodewave.id                           ║
║  Frontend: frontend@nodewave.id                       ║
║  Backend:  backend@nodewave.id                        ║
║  Client:   client@guest.com                           ║
╚══════════════════════════════════════════════════════╝
`);
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
