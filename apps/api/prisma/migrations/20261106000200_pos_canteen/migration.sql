-- The day a student left, for the admissions and withdrawals report.
ALTER TABLE "Student" ADD COLUMN "leftOn" DATE;
ALTER TABLE "School" ADD COLUMN "occupations" TEXT[] DEFAULT ARRAY[]::TEXT[];

UPDATE "Student" SET "leftOn" = "updatedAt"::date WHERE "status" = 'LEFT';

-- CreateEnum
CREATE TYPE "PosMovementType" AS ENUM ('OPENING', 'PURCHASE', 'SALE', 'SALE_VOID', 'ADJUSTMENT', 'TRANSFER_IN', 'TRANSFER_OUT');

-- CreateEnum
CREATE TYPE "PosPayment" AS ENUM ('CASH', 'ON_ACCOUNT');

-- CreateTable
CREATE TABLE "PosItem" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "barcode" TEXT,
    "category" TEXT,
    "brand" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'pcs',
    "costPrice" INTEGER NOT NULL DEFAULT 0,
    "salePrice" INTEGER NOT NULL,
    "reorderLevel" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosVendor" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosVendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosWarehouse" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "campusId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosWarehouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosStock" (
    "itemId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PosStock_pkey" PRIMARY KEY ("itemId","warehouseId")
);

-- CreateTable
CREATE TABLE "PosMovement" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "type" "PosMovementType" NOT NULL,
    "qty" INTEGER NOT NULL,
    "unitCost" INTEGER,
    "refId" TEXT,
    "note" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosPurchase" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "purchasedOn" DATE NOT NULL,
    "total" INTEGER NOT NULL,
    "paid" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosPurchaseLine" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "unitCost" INTEGER NOT NULL,

    CONSTRAINT "PosPurchaseLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosSale" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "payment" "PosPayment" NOT NULL DEFAULT 'CASH',
    "studentId" TEXT,
    "customerName" TEXT,
    "subtotal" INTEGER NOT NULL,
    "discount" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL,
    "settledAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "cashierId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosSale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosSaleLine" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "unitPrice" INTEGER NOT NULL,
    "unitCost" INTEGER NOT NULL,

    CONSTRAINT "PosSaleLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PosItem_schoolId_name_idx" ON "PosItem"("schoolId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "PosItem_schoolId_barcode_key" ON "PosItem"("schoolId", "barcode");

-- CreateIndex
CREATE UNIQUE INDEX "PosVendor_schoolId_name_key" ON "PosVendor"("schoolId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "PosWarehouse_schoolId_name_key" ON "PosWarehouse"("schoolId", "name");

-- CreateIndex
CREATE INDEX "PosMovement_schoolId_createdAt_idx" ON "PosMovement"("schoolId", "createdAt");

-- CreateIndex
CREATE INDEX "PosMovement_itemId_createdAt_idx" ON "PosMovement"("itemId", "createdAt");

-- CreateIndex
CREATE INDEX "PosPurchase_schoolId_purchasedOn_idx" ON "PosPurchase"("schoolId", "purchasedOn");

-- CreateIndex
CREATE UNIQUE INDEX "PosPurchase_schoolId_number_key" ON "PosPurchase"("schoolId", "number");

-- CreateIndex
CREATE INDEX "PosPurchaseLine_purchaseId_idx" ON "PosPurchaseLine"("purchaseId");

-- CreateIndex
CREATE INDEX "PosSale_schoolId_createdAt_idx" ON "PosSale"("schoolId", "createdAt");

-- CreateIndex
CREATE INDEX "PosSale_schoolId_studentId_settledAt_idx" ON "PosSale"("schoolId", "studentId", "settledAt");

-- CreateIndex
CREATE UNIQUE INDEX "PosSale_schoolId_number_key" ON "PosSale"("schoolId", "number");

-- CreateIndex
CREATE INDEX "PosSaleLine_saleId_idx" ON "PosSaleLine"("saleId");

-- CreateIndex
CREATE INDEX "PosSaleLine_itemId_idx" ON "PosSaleLine"("itemId");

-- AddForeignKey
ALTER TABLE "PosItem" ADD CONSTRAINT "PosItem_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosVendor" ADD CONSTRAINT "PosVendor_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosWarehouse" ADD CONSTRAINT "PosWarehouse_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosStock" ADD CONSTRAINT "PosStock_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "PosItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosStock" ADD CONSTRAINT "PosStock_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "PosWarehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosMovement" ADD CONSTRAINT "PosMovement_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "PosItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosMovement" ADD CONSTRAINT "PosMovement_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "PosWarehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosPurchase" ADD CONSTRAINT "PosPurchase_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosPurchase" ADD CONSTRAINT "PosPurchase_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "PosVendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosPurchase" ADD CONSTRAINT "PosPurchase_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "PosWarehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosPurchaseLine" ADD CONSTRAINT "PosPurchaseLine_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "PosPurchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosSale" ADD CONSTRAINT "PosSale_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosSale" ADD CONSTRAINT "PosSale_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "PosWarehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosSaleLine" ADD CONSTRAINT "PosSaleLine_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "PosSale"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Point of sale is part of the Growth and Enterprise plans.
UPDATE "Plan" SET "features" = array_append("features", 'pos')
WHERE "code" IN ('growth', 'enterprise') AND NOT ('pos' = ANY("features"));
