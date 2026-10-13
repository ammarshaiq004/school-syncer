-- CreateEnum
CREATE TYPE "InvoiceLineKind" AS ENUM ('FEE', 'ADJUSTMENT');

-- DropIndex
DROP INDEX "Payment_method_reference_key";

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledById" TEXT;

-- AlterTable
ALTER TABLE "InvoiceLine" ADD COLUMN     "addedById" TEXT,
ADD COLUMN     "kind" "InvoiceLineKind" NOT NULL DEFAULT 'FEE',
ADD COLUMN     "reason" TEXT;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "reversalReason" TEXT,
ADD COLUMN     "reversedAt" TIMESTAMP(3),
ADD COLUMN     "reversedById" TEXT;

-- Backfill (SCHOOL-130): payments settled from an online checkout are keyed by
-- the checkout's own reference; other gateway callbacks (no staff member
-- recorded them) by their gateway transaction id. Counter payments keep their
-- reference as plain text, so "cash" or a reused slip number never collides.
UPDATE "Payment" p SET "idempotencyKey" = 'checkout:' || o."txnRef"
FROM "OnlinePayment" o WHERE o."paymentId" = p."id";
UPDATE "Payment" SET "idempotencyKey" = "method"::text || ':' || "reference"
WHERE "idempotencyKey" IS NULL AND "reference" IS NOT NULL AND "receivedById" IS NULL;

-- CreateIndex
CREATE INDEX "Payment_schoolId_method_reference_idx" ON "Payment"("schoolId", "method", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_schoolId_idempotencyKey_key" ON "Payment"("schoolId", "idempotencyKey");

