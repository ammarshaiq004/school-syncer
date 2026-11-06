-- CreateEnum
CREATE TYPE "PaymentClaimStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterEnum
ALTER TYPE "FilePurpose" ADD VALUE 'PAYMENT_PROOF';

-- CreateTable
CREATE TABLE "PaymentClaim" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT,
    "paidOn" DATE NOT NULL,
    "note" TEXT,
    "proofId" TEXT,
    "status" "PaymentClaimStatus" NOT NULL DEFAULT 'PENDING',
    "rejectReason" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "paymentId" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentClaim_proofId_key" ON "PaymentClaim"("proofId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentClaim_paymentId_key" ON "PaymentClaim"("paymentId");

-- CreateIndex
CREATE INDEX "PaymentClaim_schoolId_status_idx" ON "PaymentClaim"("schoolId", "status");

-- CreateIndex
CREATE INDEX "PaymentClaim_status_createdAt_idx" ON "PaymentClaim"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "PaymentClaim" ADD CONSTRAINT "PaymentClaim_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentClaim" ADD CONSTRAINT "PaymentClaim_proofId_fkey" FOREIGN KEY ("proofId") REFERENCES "StoredFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentClaim" ADD CONSTRAINT "PaymentClaim_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "PlatformPayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
