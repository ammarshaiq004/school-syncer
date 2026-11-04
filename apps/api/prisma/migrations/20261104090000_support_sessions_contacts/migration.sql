-- CreateEnum
CREATE TYPE "SupportScope" AS ENUM ('VIEW', 'EDIT');

-- CreateEnum
CREATE TYPE "ContactKind" AS ENUM ('CALL', 'VISIT', 'MESSAGE', 'PROMISE_TO_PAY', 'NOTE');

-- CreateTable
CREATE TABLE "SupportSession" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "adminName" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "scope" "SupportScope" NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "endedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolContact" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "kind" "ContactKind" NOT NULL,
    "note" TEXT NOT NULL,
    "promisedAmount" INTEGER,
    "followUpOn" DATE,
    "doneAt" TIMESTAMP(3),
    "adminId" TEXT,
    "adminName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchoolContact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupportSession_schoolId_expiresAt_idx" ON "SupportSession"("schoolId", "expiresAt");

-- CreateIndex
CREATE INDEX "SchoolContact_schoolId_createdAt_idx" ON "SchoolContact"("schoolId", "createdAt");

-- CreateIndex
CREATE INDEX "SchoolContact_followUpOn_doneAt_idx" ON "SchoolContact"("followUpOn", "doneAt");

-- AddForeignKey
ALTER TABLE "SupportSession" ADD CONSTRAINT "SupportSession_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolContact" ADD CONSTRAINT "SchoolContact_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

