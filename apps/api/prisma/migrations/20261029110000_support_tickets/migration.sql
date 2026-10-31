-- AlterTable
ALTER TABLE "ProblemReport" ADD COLUMN     "assignedToId" TEXT;

-- AlterTable
ALTER TABLE "ProblemReportActivity" ADD COLUMN     "reply" TEXT;

-- AddForeignKey
ALTER TABLE "ProblemReport" ADD CONSTRAINT "ProblemReport_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "PlatformAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

