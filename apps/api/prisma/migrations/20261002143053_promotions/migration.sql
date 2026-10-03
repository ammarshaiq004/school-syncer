-- CreateEnum
CREATE TYPE "PromotionDecision" AS ENUM ('PROMOTE', 'REPEAT', 'LEAVE', 'GRADUATE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EnrollmentStatus" ADD VALUE 'REPEATED';
ALTER TYPE "EnrollmentStatus" ADD VALUE 'GRADUATED';

-- CreateTable
CREATE TABLE "Promotion" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "fromYearId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "decision" "PromotionDecision" NOT NULL,
    "toSectionId" TEXT,
    "decidedById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Promotion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Promotion_schoolId_idx" ON "Promotion"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "Promotion_fromYearId_studentId_key" ON "Promotion"("fromYearId", "studentId");

-- AddForeignKey
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_fromYearId_fkey" FOREIGN KEY ("fromYearId") REFERENCES "AcademicYear"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
