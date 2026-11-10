import { prisma } from '../lib/prisma';
import type { JwtPayload } from '../lib/jwt';

/**
 * Dependency Service — DAG (Directed Acyclic Graph) Management
 *
 * Service ini menangani dua hal kritis:
 * 1. Menambahkan dependensi antar-task (PM only)
 * 2. Mendeteksi CIRCULAR DEPENDENCY sebelum menyimpan
 *
 * Mengapa circular dependency berbahaya?
 * Jika Task A depends on B, B depends on C, dan C depends on A,
 * maka KETIGA task akan terkunci permanen (BLOCKED selamanya).
 * Tidak ada satupun yang bisa diselesaikan karena masing-masing
 * menunggu yang lain selesai lebih dulu — ini disebut "deadlock".
 *
 * Solusi: Deteksi siklus menggunakan DFS (Depth-First Search)
 * SEBELUM menyimpan dependensi baru ke database.
 */

export async function addDependency(
  taskId: string,
  prerequisiteId: string,
  user: JwtPayload
) {
  // Validasi: tidak boleh tergantung pada diri sendiri
  if (taskId === prerequisiteId) {
    throw new Error('A task cannot depend on itself');
  }

  // Validasi: kedua task harus ada dan belum dihapus
  const [task, prerequisite] = await Promise.all([
    prisma.task.findFirst({ where: { id: taskId, deletedAt: null } }),
    prisma.task.findFirst({ where: { id: prerequisiteId, deletedAt: null } }),
  ]);

  if (!task) throw new Error('Task not found');
  if (!prerequisite) throw new Error('Prerequisite task not found');

  // Validasi: keduanya harus berada di proyek yang sama
  if (task.projectId !== prerequisite.projectId) {
    throw new Error('Both tasks must belong to the same project');
  }

  // Validasi: dependensi belum ada
  const existing = await prisma.taskDependency.findUnique({
    where: {
      taskId_prerequisiteId: { taskId, prerequisiteId },
    },
  });

  if (existing) {
    throw new Error('This dependency already exists');
  }

  // ── CIRCULAR DEPENDENCY DETECTION (DFS) ──
  //
  // Kita perlu memeriksa: jika kita menambahkan edge (taskId → prerequisiteId),
  // apakah akan terbentuk siklus?
  //
  // Caranya: mulai dari prerequisiteId, telusuri semua dependency-nya secara
  // rekursif. Jika kita menemukan taskId di antara dependency-nya,
  // berarti akan terbentuk siklus → TOLAK.
  const wouldCreateCycle = await detectCycle(prerequisiteId, taskId);
  if (wouldCreateCycle) {
    throw new Error(
      'Cannot add dependency: This would create a circular dependency (deadlock). ' +
      `Adding "${prerequisite.title}" as prerequisite for "${task.title}" would create a cycle.`
    );
  }

  // Simpan dependensi baru
  const dependency = await prisma.taskDependency.create({
    data: { taskId, prerequisiteId },
    include: {
      task: { select: { id: true, title: true, status: true } },
      prerequisite: { select: { id: true, title: true, status: true } },
    },
  });

  // Jika prerequisite belum DONE, otomatis set task ke BLOCKED
  if (prerequisite.status !== 'DONE' && task.status !== 'BLOCKED') {
    await prisma.task.update({
      where: { id: taskId },
      data: { status: 'BLOCKED' },
    });
  }

  return dependency;
}

export async function removeDependency(taskId: string, dependencyId: string) {
  const dependency = await prisma.taskDependency.findFirst({
    where: { id: dependencyId, taskId },
  });

  if (!dependency) {
    throw new Error('Dependency not found');
  }

  await prisma.taskDependency.delete({ where: { id: dependencyId } });

  // Setelah menghapus dependensi, periksa apakah task yang tadinya
  // BLOCKED kini bisa di-unblock
  const remainingBlockers = await prisma.taskDependency.findMany({
    where: {
      taskId,
      prerequisite: {
        status: { not: 'DONE' },
        deletedAt: null,
      },
    },
  });

  if (remainingBlockers.length === 0) {
    await prisma.task.updateMany({
      where: { id: taskId, status: 'BLOCKED', deletedAt: null },
      data: { status: 'TODO' },
    });
  }

  return { message: 'Dependency removed successfully' };
}

export async function getTaskDependencies(taskId: string) {
  const task = await prisma.task.findFirst({
    where: { id: taskId, deletedAt: null },
  });

  if (!task) {
    throw new Error('Task not found');
  }

  const dependencies = await prisma.taskDependency.findMany({
    where: { taskId },
    include: {
      prerequisite: {
        select: {
          id: true,
          title: true,
          status: true,
          department: true,
          assignee: {
            select: { id: true, name: true },
          },
        },
      },
    },
  });

  return dependencies;
}

/**
 * Circular Dependency Detection menggunakan DFS (Depth-First Search)
 *
 * Algoritma:
 * 1. Mulai dari node `startId` (prerequisite yang ingin ditambahkan)
 * 2. Telusuri semua dependency-nya secara rekursif (DFS)
 * 3. Jika di path manapun kita menemukan `targetId` (task yang akan ditambahkan dependency-nya),
 *    berarti akan terbentuk siklus → return true
 * 4. Gunakan Set `visited` untuk menghindari infinite loop pada graph yang sudah ada
 *
 * Contoh:
 *   Existing: B depends on C
 *   Ingin menambahkan: A depends on B
 *   DFS dari B: B → C (C punya deps? tidak) → tidak menemukan A → OK, aman
 *
 *   Existing: A depends on B, B depends on C
 *   Ingin menambahkan: C depends on A
 *   DFS dari A: A → (cek deps of A) → B → (cek deps of B) → C → found targetId (C)!
 *   Wait, kita start dari A (startId=A, targetId=C)
 *   Sebenarnya: startId = prerequisiteId = A, targetId = taskId = C
 *   DFS: mulai dari A, lihat dependency A → B, ikuti B → lihat dependency B → C
 *   Kita menemukan C (targetId) di jalur dependency A → siklus terdeteksi!
 */
async function detectCycle(
  startId: string,
  targetId: string
): Promise<boolean> {
  const visited = new Set<string>();

  async function dfs(currentId: string): Promise<boolean> {
    if (currentId === targetId) {
      return true; // Siklus ditemukan!
    }

    if (visited.has(currentId)) {
      return false; // Sudah dikunjungi, skip
    }

    visited.add(currentId);

    // Ambil semua task yang menjadi dependency dari currentId
    const dependencies = await prisma.taskDependency.findMany({
      where: { taskId: currentId },
      select: { prerequisiteId: true },
    });

    for (const dep of dependencies) {
      if (await dfs(dep.prerequisiteId)) {
        return true; // Propagasi: siklus ditemukan di sub-tree
      }
    }

    return false;
  }

  return dfs(startId);
}
