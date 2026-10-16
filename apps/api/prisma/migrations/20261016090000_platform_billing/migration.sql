-- CreateEnum
CREATE TYPE "PlatformPaymentStatus" AS ENUM ('RECORDED', 'VOID');

-- CreateEnum
CREATE TYPE "PlatformNoticeSeverity" AS ENUM ('INFO', 'WARNING', 'URGENT');

-- AlterTable
ALTER TABLE "PlatformInvoice" ADD COLUMN     "amountPaid" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "taxAmount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "taxPercent" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "voidReason" TEXT;

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "billedFrom" TEXT;

-- CreateTable
CREATE TABLE "PlatformPayment" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT,
    "receivedOn" DATE NOT NULL,
    "note" TEXT,
    "status" "PlatformPaymentStatus" NOT NULL DEFAULT 'RECORDED',
    "voidReason" TEXT,
    "voidedAt" TIMESTAMP(3),
    "recordedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformPaymentAllocation" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,

    CONSTRAINT "PlatformPaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformNotice" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "severity" "PlatformNoticeSeverity" NOT NULL DEFAULT 'INFO',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "invoiceId" TEXT,
    "paymentId" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformNotice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "businessName" TEXT NOT NULL DEFAULT 'SchoolSyncer',
    "address" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "ntn" TEXT,
    "strn" TEXT,
    "salesTaxPercent" INTEGER,
    "paymentInstructions" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformPayment_number_key" ON "PlatformPayment"("number");

-- CreateIndex
CREATE INDEX "PlatformPayment_schoolId_receivedOn_idx" ON "PlatformPayment"("schoolId", "receivedOn");

-- CreateIndex
CREATE INDEX "PlatformPaymentAllocation_invoiceId_idx" ON "PlatformPaymentAllocation"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformPaymentAllocation_paymentId_invoiceId_key" ON "PlatformPaymentAllocation"("paymentId", "invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformNotice_dedupeKey_key" ON "PlatformNotice"("dedupeKey");

-- CreateIndex
CREATE INDEX "PlatformNotice_schoolId_createdAt_idx" ON "PlatformNotice"("schoolId", "createdAt");

-- AddForeignKey
ALTER TABLE "PlatformPayment" ADD CONSTRAINT "PlatformPayment_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformPaymentAllocation" ADD CONSTRAINT "PlatformPaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "PlatformPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformPaymentAllocation" ADD CONSTRAINT "PlatformPaymentAllocation_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "PlatformInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformNotice" ADD CONSTRAINT "PlatformNotice_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Bills already marked paid become a payment each, applied in full, so the
-- new ledger starts from the same balances. Receipt numbers mirror the bill's.
INSERT INTO "PlatformPayment" ("id", "number", "schoolId", "amount", "method", "reference", "receivedOn", "recordedBy", "createdAt")
SELECT 'mig_' || i."id", 'SR-' || substring(i."number" from 4), i."schoolId", i."amount",
       coalesce(i."method", 'Not recorded'), i."reference",
       coalesce(i."paidAt", i."createdAt")::date, NULL, coalesce(i."paidAt", i."createdAt")
FROM "PlatformInvoice" i
WHERE i."status" = 'PAID';

INSERT INTO "PlatformPaymentAllocation" ("id", "paymentId", "invoiceId", "amount")
SELECT 'mig_' || i."id", 'mig_' || i."id", i."id", i."amount"
FROM "PlatformInvoice" i
WHERE i."status" = 'PAID';

UPDATE "PlatformInvoice" SET "amountPaid" = "amount" WHERE "status" = 'PAID';
