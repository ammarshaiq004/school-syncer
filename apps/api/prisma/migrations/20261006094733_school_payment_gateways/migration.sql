-- CreateTable
CREATE TABLE "SchoolPaymentGateway" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "provider" "PaymentMethod" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "secrets" TEXT NOT NULL DEFAULT '',
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolPaymentGateway_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SchoolPaymentGateway_schoolId_provider_key" ON "SchoolPaymentGateway"("schoolId", "provider");

-- AddForeignKey
ALTER TABLE "SchoolPaymentGateway" ADD CONSTRAINT "SchoolPaymentGateway_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
