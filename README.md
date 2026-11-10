# NodeWave Deliverables Management System (Backend API)

Operational backbone REST API built for the **NodeWave Fullstack / Product Engineer Technical Assessment**.

## Tech Stack
- **Language & Runtime:** TypeScript (`strict: true`) on **Bun**
- **HTTP Framework:** **Hono**
- **ORM & Database:** **Prisma ORM** + **PostgreSQL**
- **Authentication:** JWT (`jsonwebtoken`) + `bcryptjs`
- **Filtering, Searching & Pagination:** `@nodewave/prisma-ezfilter`
- **Validation:** **Zod** DTO schemas
- **Testing & CI:** `bun test` + GitHub Actions CI

---

## Architecture Overview

### 1. Multi-Dimensional Authorization (`RBAC + ABAC`)
Implemented across `src/middlewares/auth.ts` and `src/services/task.service.ts`:
- **Role-Based (`RBAC`):** `requireRole(['PM'])` guards project/task creation, core description edits, and dependency management.
- **State-Based (`ABAC`):**
  - **PM Restriction:** Product Managers have full read/write access to projects and tasks, **except** they are explicitly forbidden (`HTTP 403 Forbidden`) from transitioning a task status to `DONE` (only the assigned executor can complete it).
  - **Internal Team Ownership:** Internal Engineers (`UIUX`, `FRONTEND`, `BACKEND`) can only view projects assigned to them, cannot modify core task descriptions, and can only transition status or upload attachments on tasks assigned to them.

### 2. Inter-Task Dependencies (`DAG` + DFS Circular Detection)
Implemented in `src/services/dependency.service.ts` and `src/services/task.service.ts`:
- Tasks form a **Directed Acyclic Graph (DAG)** via the `TaskDependency` join model (`taskId` -> `prerequisiteId`).
- When a task is moved to `IN_PROGRESS` or `DONE`, the backend verifies that all prerequisite tasks have `status === 'DONE'`. Otherwise, it rejects the request with `HTTP 400 Bad Request` listing the exact blocking tasks.
- When a prerequisite task is completed (`DONE`), `unblockDependentTasks()` automatically transitions any downstream `BLOCKED` tasks whose prerequisites are now all `DONE` into `TODO`.
- **Circular Dependency Prevention:** Before saving a new dependency, `detectCycle()` runs a recursive **Depth-First Search (DFS)** traversal to prevent `A -> B -> C -> A` deadlocks.

### 3. Concurrency Control & Optimistic Locking (`409 Conflict`)
Implemented in `src/services/task.service.ts`:
- Every `Task` row maintains an integer `version` column (default `1`).
- Every update (`PATCH /api/tasks/:id` and `PATCH /api/tasks/:id/status`) requires the client's last-read `version` and executes an atomic conditional update:
  ```ts
  const result = await prisma.task.updateMany({
    where: { id: taskId, version: clientVersion, deletedAt: null },
    data: { ...updates, version: { increment: 1 } },
  });
  if (result.count === 0) throw HTTP 409 Conflict;
  ```

### 4. Multi-Tenant Isolation & API-Level Data Masking (`CLIENT_GUEST`)
Implemented in `src/services/project.service.ts` and `src/services/task.service.ts`:
- Client Guests are strictly scoped to projects where `project.clientId === user.userId` and tasks where `isClientVisible === true`.
- Before serializing the JSON response, `maskTaskForClient()` strips `assignee` (`null`), `auditLogs` (`[]`), and internal attachments at the **API response layer** (never relying on CSS/frontend hiding).

### 5. Immutable Audit Trail (`CDC`) & Soft Deletes
Implemented in `src/lib/audit.ts`:
- Every entity uses `deletedAt: DateTime?` (Soft Delete). No physical `DELETE` is ever executed on core domain records.
- `recordAuditTrail()` performs a field-by-field diff before every update and appends immutable entries (`userId`, `createdAt`, `changedColumn`, `oldValue`, `newValue`) to `AuditLog`.
- Includes the bonus **Daily Standup Auto-Summary** endpoint (`GET /api/projects/:id/daily-summary`) aggregating yesterday's completed tasks and today's blocked tasks per department.

---

## Seeded Demo Credentials

All seeded accounts use password: `Password123!`

| Role | Department | Email | Password |
|---|---|---|---|
| **Product Manager** | `PRODUCT` | `pm@nodewave.id` | `Password123!` |
| **Internal Team** | `UIUX` | `uiux@nodewave.id` | `Password123!` |
| **Internal Team** | `FRONTEND` | `frontend@nodewave.id` | `Password123!` |
| **Internal Team** | `BACKEND` | `backend@nodewave.id` | `Password123!` |
| **Client Guest** | `CLIENT` | `client@guest.com` | `Password123!` |

---

## Local Setup & Commands

```bash
# 1. Install dependencies
bun install

# 2. Push Prisma schema to PostgreSQL
bun run db:push

# 3. Seed demo users, project, tasks, DAG dependencies, and audit logs
bun run db:seed

# 4. Run development server (http://localhost:4000)
bun run dev

# 5. Run unit & security test suite
bun test
```
