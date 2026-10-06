-- CreateEnum
CREATE TYPE "ReconciliationStatus" AS ENUM ('RUNNING', 'CLEAN', 'ISSUES', 'FAILED');

-- CreateEnum
CREATE TYPE "ReconciliationIssueKind" AS ENUM ('NEEDS_REVIEW', 'RECEIPT_MISMATCH', 'STILL_PENDING', 'NOT_IN_STATEMENT', 'NOT_IN_BOOKS', 'AMOUNT_MISMATCH');

-- CreateEnum
CREATE TYPE "ReconciliationIssueStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateTable
CREATE TABLE "PaymentReconciliation" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "ReconciliationStatus" NOT NULL DEFAULT 'RUNNING',
    "checked" INTEGER NOT NULL DEFAULT 0,
    "settled" INTEGER NOT NULL DEFAULT 0,
    "totals" JSONB NOT NULL DEFAULT '{}',
    "openIssues" INTEGER NOT NULL DEFAULT 0,
    "trigger" TEXT NOT NULL DEFAULT 'auto',
    "error" TEXT,
    "ranById" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "PaymentReconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationIssue" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "kind" "ReconciliationIssueKind" NOT NULL,
    "provider" "PaymentMethod" NOT NULL,
    "status" "ReconciliationIssueStatus" NOT NULL DEFAULT 'OPEN',
    "key" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "amount" INTEGER,
    "detail" TEXT NOT NULL,
    "onlinePaymentId" TEXT,
    "statementLineId" TEXT,
    "note" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReconciliationIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GatewayStatement" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "provider" "PaymentMethod" NOT NULL,
    "fileName" TEXT NOT NULL,
    "fromDate" DATE NOT NULL,
    "toDate" DATE NOT NULL,
    "rows" INTEGER NOT NULL,
    "matched" INTEGER NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GatewayStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GatewayStatementLine" (
    "id" TEXT NOT NULL,
    "statementId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "provider" "PaymentMethod" NOT NULL,
    "date" DATE NOT NULL,
    "reference" TEXT NOT NULL,
    "providerRef" TEXT,
    "amount" INTEGER NOT NULL,
    "onlinePaymentId" TEXT,

    CONSTRAINT "GatewayStatementLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentReconciliation_schoolId_date_key" ON "PaymentReconciliation"("schoolId", "date");

-- CreateIndex
CREATE INDEX "ReconciliationIssue_schoolId_status_date_idx" ON "ReconciliationIssue"("schoolId", "status", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ReconciliationIssue_schoolId_key_key" ON "ReconciliationIssue"("schoolId", "key");

-- CreateIndex
CREATE INDEX "GatewayStatementLine_schoolId_provider_date_idx" ON "GatewayStatementLine"("schoolId", "provider", "date");

-- CreateIndex
CREATE INDEX "OnlinePayment_status_provider_idx" ON "OnlinePayment"("status", "provider");

-- AddForeignKey
ALTER TABLE "PaymentReconciliation" ADD CONSTRAINT "PaymentReconciliation_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationIssue" ADD CONSTRAINT "ReconciliationIssue_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationIssue" ADD CONSTRAINT "ReconciliationIssue_onlinePaymentId_fkey" FOREIGN KEY ("onlinePaymentId") REFERENCES "OnlinePayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationIssue" ADD CONSTRAINT "ReconciliationIssue_statementLineId_fkey" FOREIGN KEY ("statementLineId") REFERENCES "GatewayStatementLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GatewayStatement" ADD CONSTRAINT "GatewayStatement_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GatewayStatementLine" ADD CONSTRAINT "GatewayStatementLine_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "GatewayStatement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GatewayStatementLine" ADD CONSTRAINT "GatewayStatementLine_onlinePaymentId_fkey" FOREIGN KEY ("onlinePaymentId") REFERENCES "OnlinePayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
