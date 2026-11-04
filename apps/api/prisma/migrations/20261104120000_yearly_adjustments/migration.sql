-- CreateEnum
CREATE TYPE "BillingCycle" AS ENUM ('MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "AdjustmentKind" AS ENUM ('PLAN_CHANGE', 'REFERRAL', 'GOODWILL', 'CARRIED');

-- AlterTable
ALTER TABLE "PlatformInvoice" ADD COLUMN     "adjustmentAmount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "monthsCovered" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "billingCycle" "BillingCycle" NOT NULL DEFAULT 'MONTHLY',
ADD COLUMN     "yearlyStudents" INTEGER,
ADD COLUMN     "yearlyUntil" TEXT;

-- CreateTable
CREATE TABLE "PlatformAdjustment" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "kind" "AdjustmentKind" NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "createdBy" TEXT,
    "invoiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlatformAdjustment_schoolId_invoiceId_idx" ON "PlatformAdjustment"("schoolId", "invoiceId");

-- AddForeignKey
ALTER TABLE "PlatformAdjustment" ADD CONSTRAINT "PlatformAdjustment_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformAdjustment" ADD CONSTRAINT "PlatformAdjustment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "PlatformInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

