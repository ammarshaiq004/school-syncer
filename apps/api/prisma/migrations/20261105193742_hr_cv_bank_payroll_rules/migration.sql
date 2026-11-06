-- CreateEnum
CREATE TYPE "CandidateStatus" AS ENUM ('NEW', 'SHORTLISTED', 'INTERVIEWED', 'OFFERED', 'HIRED', 'REJECTED');

-- AlterEnum
ALTER TYPE "FilePurpose" ADD VALUE 'CANDIDATE_CV';

-- AlterTable
ALTER TABLE "Payslip" ADD COLUMN     "lateDeduction" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "shortLeaveDeduction" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "StaffAttendance" ADD COLUMN     "checkIn" TEXT;

-- CreateTable
CREATE TABLE "ShortLeave" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "fromTime" TEXT NOT NULL,
    "toTime" TEXT NOT NULL,
    "reason" TEXT,
    "status" "LeaveStatus" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShortLeave_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollRules" (
    "schoolId" TEXT NOT NULL,
    "shiftStart" TEXT NOT NULL DEFAULT '08:00',
    "graceMinutes" INTEGER NOT NULL DEFAULT 10,
    "latesPerDeduction" INTEGER NOT NULL DEFAULT 3,
    "lateDeductionPercent" INTEGER NOT NULL DEFAULT 100,
    "freeShortLeaves" INTEGER NOT NULL DEFAULT 2,
    "shortLeaveDeductionPercent" INTEGER NOT NULL DEFAULT 50,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollRules_pkey" PRIMARY KEY ("schoolId")
);

-- CreateTable
CREATE TABLE "Candidate" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "position" TEXT NOT NULL,
    "qualification" TEXT,
    "experienceYears" INTEGER NOT NULL DEFAULT 0,
    "expectedSalary" INTEGER,
    "source" TEXT,
    "status" "CandidateStatus" NOT NULL DEFAULT 'NEW',
    "notes" TEXT,
    "cvId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Candidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffCertificate" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "serialNo" TEXT NOT NULL,
    "verifyCode" TEXT NOT NULL,
    "issuedOn" DATE NOT NULL,
    "details" JSONB NOT NULL,
    "issuedById" TEXT NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffCertificate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShortLeave_schoolId_status_idx" ON "ShortLeave"("schoolId", "status");

-- CreateIndex
CREATE INDEX "ShortLeave_userId_date_idx" ON "ShortLeave"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Candidate_cvId_key" ON "Candidate"("cvId");

-- CreateIndex
CREATE INDEX "Candidate_schoolId_status_idx" ON "Candidate"("schoolId", "status");

-- CreateIndex
CREATE INDEX "Candidate_schoolId_position_idx" ON "Candidate"("schoolId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "StaffCertificate_verifyCode_key" ON "StaffCertificate"("verifyCode");

-- CreateIndex
CREATE INDEX "StaffCertificate_userId_idx" ON "StaffCertificate"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffCertificate_schoolId_serialNo_key" ON "StaffCertificate"("schoolId", "serialNo");

-- AddForeignKey
ALTER TABLE "ShortLeave" ADD CONSTRAINT "ShortLeave_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRules" ADD CONSTRAINT "PayrollRules_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_cvId_fkey" FOREIGN KEY ("cvId") REFERENCES "StoredFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffCertificate" ADD CONSTRAINT "StaffCertificate_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffCertificate" ADD CONSTRAINT "StaffCertificate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffCertificate" ADD CONSTRAINT "StaffCertificate_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

