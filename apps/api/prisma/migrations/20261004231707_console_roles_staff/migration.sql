-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('OWNER', 'SUPPORT');

-- DropIndex
DROP INDEX "RoleAssignment_userId_role_campusId_key";

-- AlterTable
ALTER TABLE "PlatformAdmin" ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "role" "PlatformRole" NOT NULL DEFAULT 'SUPPORT';

-- AlterTable
ALTER TABLE "RoleAssignment" ADD COLUMN     "customRoleId" TEXT;

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "featuresAdded" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "featuresRemoved" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "CustomRole" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "baseRole" "Role" NOT NULL,
    "permissions" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuiltinRolePermission" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "permissions" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuiltinRolePermission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomRole_schoolId_name_key" ON "CustomRole"("schoolId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "BuiltinRolePermission_schoolId_role_key" ON "BuiltinRolePermission"("schoolId", "role");

-- CreateIndex
CREATE INDEX "AuditLog_schoolId_entity_createdAt_idx" ON "AuditLog"("schoolId", "entity", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_schoolId_userId_createdAt_idx" ON "AuditLog"("schoolId", "userId", "createdAt");

-- CreateIndex
CREATE INDEX "PlatformAuditLog_adminId_createdAt_idx" ON "PlatformAuditLog"("adminId", "createdAt");

-- CreateIndex
CREATE INDEX "PlatformAuditLog_action_createdAt_idx" ON "PlatformAuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "PlatformAuditLog_createdAt_idx" ON "PlatformAuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "RoleAssignment_customRoleId_idx" ON "RoleAssignment"("customRoleId");

-- CreateIndex
CREATE UNIQUE INDEX "RoleAssignment_userId_role_campusId_customRoleId_key" ON "RoleAssignment"("userId", "role", "campusId", "customRoleId");

-- AddForeignKey
ALTER TABLE "RoleAssignment" ADD CONSTRAINT "RoleAssignment_customRoleId_fkey" FOREIGN KEY ("customRoleId") REFERENCES "CustomRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomRole" ADD CONSTRAINT "CustomRole_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuiltinRolePermission" ADD CONSTRAINT "BuiltinRolePermission_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill: every platform admin that existed before staff roles is an owner.
-- New admins default to SUPPORT.
UPDATE "PlatformAdmin" SET "role" = 'OWNER';

-- A custom role builds on a staff role; OWNER, PARENT and STUDENT cannot be a base.
-- (Not expressible in Prisma; Prisma's drift check ignores CHECK constraints.)
ALTER TABLE "CustomRole" ADD CONSTRAINT "CustomRole_baseRole_check"
  CHECK ("baseRole" NOT IN ('OWNER', 'PARENT', 'STUDENT'));
