-- CreateEnum
CREATE TYPE "DiscountKind" AS ENUM ('PERCENT', 'FIXED');

-- AlterTable
ALTER TABLE "PlatformInvoice" ADD COLUMN     "discountAmount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "discountName" TEXT;

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "agreedMinimumMonthly" INTEGER,
ADD COLUMN     "agreedNote" TEXT,
ADD COLUMN     "agreedPricePerStudent" INTEGER;

-- CreateTable
CREATE TABLE "PlatformDiscount" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "DiscountKind" NOT NULL,
    "value" INTEGER NOT NULL,
    "schoolId" TEXT,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformDiscount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformDiscountUse" (
    "id" TEXT NOT NULL,
    "discountId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformDiscountUse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlatformDiscount_isActive_startsOn_idx" ON "PlatformDiscount"("isActive", "startsOn");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformDiscountUse_invoiceId_key" ON "PlatformDiscountUse"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformDiscountUse_discountId_schoolId_key" ON "PlatformDiscountUse"("discountId", "schoolId");

-- AddForeignKey
ALTER TABLE "PlatformDiscountUse" ADD CONSTRAINT "PlatformDiscountUse_discountId_fkey" FOREIGN KEY ("discountId") REFERENCES "PlatformDiscount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformDiscountUse" ADD CONSTRAINT "PlatformDiscountUse_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformDiscountUse" ADD CONSTRAINT "PlatformDiscountUse_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "PlatformInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

