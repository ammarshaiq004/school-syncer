-- CreateEnum
CREATE TYPE "InvoiceKind" AS ENUM ('MONTHLY', 'ADHOC');

-- CreateEnum
CREATE TYPE "VoucherRunStatus" AS ENUM ('RUNNING', 'DONE', 'FAILED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "InvoiceLineKind" ADD VALUE 'SIBLING_DISCOUNT';
ALTER TYPE "InvoiceLineKind" ADD VALUE 'LATE_FINE';
ALTER TYPE "InvoiceLineKind" ADD VALUE 'ARREARS';

-- AlterEnum
ALTER TYPE "InvoiceStatus" ADD VALUE 'CARRIED_FORWARD';

-- DropIndex
DROP INDEX "Invoice_studentId_period_key";

-- AlterTable
ALTER TABLE "Concession" ADD COLUMN     "validFrom" TEXT,
ADD COLUMN     "validTo" TEXT;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "arrears" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "carriedToId" TEXT,
ADD COLUMN     "fineBooked" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "fineWaivedAt" TIMESTAMP(3),
ADD COLUMN     "fineWaivedById" TEXT,
ADD COLUMN     "fineWaiverReason" TEXT,
ADD COLUMN     "kind" "InvoiceKind" NOT NULL DEFAULT 'MONTHLY',
ADD COLUMN     "monthlyPeriod" TEXT,
ADD COLUMN     "runId" TEXT;

-- Every voucher so far came from a monthly run: keep one per student per month.
UPDATE "Invoice" SET "monthlyPeriod" = "period";

-- AlterTable
ALTER TABLE "School" ADD COLUMN     "admissionFeeHeadId" TEXT,
ADD COLUMN     "carryForwardArrears" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lateFeeCap" INTEGER,
ADD COLUMN     "lateFeeMaxDays" INTEGER,
ADD COLUMN     "siblingFeeHeadIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "siblingSecondPercent" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "siblingThirdPercent" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "VoucherRun" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "classId" TEXT,
    "lockKey" TEXT,
    "status" "VoucherRunStatus" NOT NULL DEFAULT 'RUNNING',
    "startedById" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "students" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "totalBilled" INTEGER NOT NULL DEFAULT 0,
    "carried" INTEGER NOT NULL DEFAULT 0,
    "messages" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "VoucherRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VoucherRun_lockKey_key" ON "VoucherRun"("lockKey");

-- CreateIndex
CREATE INDEX "VoucherRun_schoolId_startedAt_idx" ON "VoucherRun"("schoolId", "startedAt");

-- CreateIndex
CREATE INDEX "Invoice_schoolId_status_dueDate_idx" ON "Invoice"("schoolId", "status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_studentId_monthlyPeriod_key" ON "Invoice"("studentId", "monthlyPeriod");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_carriedToId_fkey" FOREIGN KEY ("carriedToId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_runId_fkey" FOREIGN KEY ("runId") REFERENCES "VoucherRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherRun" ADD CONSTRAINT "VoucherRun_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

