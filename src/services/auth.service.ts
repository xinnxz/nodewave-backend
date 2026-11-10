import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { signToken, type JwtPayload } from '../lib/jwt';
import type { RegisterInput, LoginInput } from '../validators/auth.validator';

/**
 * Auth Service
 *
 * Service layer berisi business logic murni — terpisah dari HTTP layer (routes).
 * Pemisahan ini mengikuti prinsip Separation of Concerns:
 * - Routes: menangani HTTP request/response
 * - Services: menangani logika bisnis
 * - Prisma: menangani akses database
 *
 * Keuntungan:
 * - Service bisa di-unit-test tanpa menyalakan HTTP server
 * - Service bisa dipakai ulang di tempat lain (background job, CLI, dll.)
 */

const SALT_ROUNDS = 10;

export async function registerUser(input: RegisterInput) {
  // Cek apakah email sudah terdaftar
  const existingUser = await prisma.user.findUnique({
    where: { email: input.email },
  });

  if (existingUser) {
    throw new Error('Email already registered');
  }

  // Hash password dengan bcrypt
  // bcrypt menambahkan "salt" random ke password sebelum hashing,
  // sehingga dua user dengan password sama akan menghasilkan hash berbeda.
  // SALT_ROUNDS = 10 artinya 2^10 = 1024 iterasi hashing (standar industri).
  const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);

  const user = await prisma.user.create({
    data: {
      email: input.email,
      passwordHash,
      name: input.name,
      role: input.role,
      department: input.department,
      avatarUrl: input.avatarUrl,
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      department: true,
      avatarUrl: true,
      createdAt: true,
    },
  });

  // Langsung generate token setelah register (auto-login)
  const token = signToken({
    userId: user.id,
    email: user.email,
    role: user.role,
    department: user.department,
  });

  return { user, token };
}

export async function loginUser(input: LoginInput) {
  const user = await prisma.user.findUnique({
    where: { email: input.email, deletedAt: null },
  });

  if (!user) {
    throw new Error('Invalid email or password');
  }

  // Bandingkan password yang dikirim dengan hash di database
  const isPasswordValid = await bcrypt.compare(input.password, user.passwordHash);

  if (!isPasswordValid) {
    throw new Error('Invalid email or password');
  }

  const token = signToken({
    userId: user.id,
    email: user.email,
    role: user.role,
    department: user.department,
  });

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      department: user.department,
      avatarUrl: user.avatarUrl,
    },
    token,
  };
}

export async function getUserProfile(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId, deletedAt: null },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      department: true,
      avatarUrl: true,
      createdAt: true,
    },
  });

  if (!user) {
    throw new Error('User not found');
  }

  return user;
}

export async function listUsers() {
  return prisma.user.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      department: true,
      avatarUrl: true,
    },
    orderBy: { name: 'asc' },
  });
}
