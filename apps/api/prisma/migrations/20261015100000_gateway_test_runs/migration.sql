-- CreateTable
CREATE TABLE "GatewayTestRun" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "provider" "PaymentMethod" NOT NULL,
    "mode" TEXT NOT NULL,
    "account" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "checkoutId" TEXT,
    "startedById" TEXT,
    "callbackAt" TIMESTAMP(3),
    "events" JSONB NOT NULL DEFAULT '[]',
    "reversedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "outcome" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GatewayTestRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GatewayTestRun_checkoutId_key" ON "GatewayTestRun"("checkoutId");

-- CreateIndex
CREATE INDEX "GatewayTestRun_createdAt_idx" ON "GatewayTestRun"("createdAt");

-- CreateIndex
CREATE INDEX "GatewayTestRun_schoolId_createdAt_idx" ON "GatewayTestRun"("schoolId", "createdAt");

-- AddForeignKey
ALTER TABLE "GatewayTestRun" ADD CONSTRAINT "GatewayTestRun_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GatewayTestRun" ADD CONSTRAINT "GatewayTestRun_checkoutId_fkey" FOREIGN KEY ("checkoutId") REFERENCES "OnlinePayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GatewayTestRun" ADD CONSTRAINT "GatewayTestRun_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "PlatformAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

