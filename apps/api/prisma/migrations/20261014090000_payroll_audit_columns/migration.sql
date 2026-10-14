-- Who generated, finalised and paid payroll (SCHOOL-138). Existing runs take
-- their last known change as updatedAt; the default is dropped afterwards
-- because Prisma sets updatedAt itself.
ALTER TABLE "PayrollRun" ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "finalizedById" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "PayrollRun" SET "updatedAt" = COALESCE("finalizedAt", "createdAt");
ALTER TABLE "PayrollRun" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Payslip" ADD COLUMN     "paidById" TEXT;
