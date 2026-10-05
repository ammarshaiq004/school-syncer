-- Who really made a change during a support session.
ALTER TABLE "AuditLog" ADD COLUMN "support" JSONB;

-- Postgres treats NULLs as distinct in unique indexes, and almost every grant
-- has customRoleId (and many campusId) NULL, so the plain unique index did not
-- stop duplicate grants. Remove any duplicates, then rebuild it NULLS NOT DISTINCT.
DELETE FROM "RoleAssignment" a
USING "RoleAssignment" b
WHERE a."userId" = b."userId"
  AND a."role" = b."role"
  AND a."campusId" IS NOT DISTINCT FROM b."campusId"
  AND a."customRoleId" IS NOT DISTINCT FROM b."customRoleId"
  AND a."id" > b."id";

DROP INDEX "RoleAssignment_userId_role_campusId_customRoleId_key";
CREATE UNIQUE INDEX "RoleAssignment_userId_role_campusId_customRoleId_key"
  ON "RoleAssignment"("userId", "role", "campusId", "customRoleId") NULLS NOT DISTINCT;
