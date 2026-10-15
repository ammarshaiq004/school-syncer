-- CreateEnum
CREATE TYPE "ProblemReportStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'FIXED', 'WONT_FIX');

-- CreateEnum
CREATE TYPE "ProblemReportSource" AS ENUM ('WEB', 'MOBILE');

-- AlterEnum
ALTER TYPE "FilePurpose" ADD VALUE 'PROBLEM_REPORT';

-- AlterTable
ALTER TABLE "School" ADD COLUMN     "setupChecklistDismissedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ProblemReport" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "reporterId" TEXT,
    "reporterName" TEXT NOT NULL,
    "roles" "Role"[],
    "source" "ProblemReportSource" NOT NULL,
    "message" TEXT NOT NULL,
    "page" TEXT NOT NULL,
    "appVersion" TEXT,
    "browser" TEXT,
    "screenshotId" TEXT,
    "status" "ProblemReportStatus" NOT NULL DEFAULT 'NEW',
    "statusChangedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProblemReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProblemReportActivity" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "adminId" TEXT,
    "adminName" TEXT NOT NULL,
    "status" "ProblemReportStatus",
    "fromStatus" "ProblemReportStatus",
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProblemReportActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserActivityDay" (
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "schoolId" TEXT NOT NULL,
    "roles" "Role"[],

    CONSTRAINT "UserActivityDay_pkey" PRIMARY KEY ("userId","date")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProblemReport_screenshotId_key" ON "ProblemReport"("screenshotId");

-- CreateIndex
CREATE INDEX "ProblemReport_schoolId_createdAt_idx" ON "ProblemReport"("schoolId", "createdAt");

-- CreateIndex
CREATE INDEX "ProblemReport_status_createdAt_idx" ON "ProblemReport"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ProblemReport_reporterId_createdAt_idx" ON "ProblemReport"("reporterId", "createdAt");

-- CreateIndex
CREATE INDEX "ProblemReportActivity_reportId_createdAt_idx" ON "ProblemReportActivity"("reportId", "createdAt");

-- CreateIndex
CREATE INDEX "UserActivityDay_schoolId_date_idx" ON "UserActivityDay"("schoolId", "date");

-- AddForeignKey
ALTER TABLE "ProblemReport" ADD CONSTRAINT "ProblemReport_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemReport" ADD CONSTRAINT "ProblemReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemReport" ADD CONSTRAINT "ProblemReport_screenshotId_fkey" FOREIGN KEY ("screenshotId") REFERENCES "StoredFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemReportActivity" ADD CONSTRAINT "ProblemReportActivity_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "ProblemReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemReportActivity" ADD CONSTRAINT "ProblemReportActivity_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "PlatformAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserActivityDay" ADD CONSTRAINT "UserActivityDay_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserActivityDay" ADD CONSTRAINT "UserActivityDay_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

