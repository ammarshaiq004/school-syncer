-- Students with no recorded gender are no longer forced to Male.
ALTER TYPE "Gender" ADD VALUE 'UNSPECIFIED';

-- Advance credits kept per student.
CREATE TABLE "StudentCredit" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "note" TEXT,
    "effectiveOn" DATE NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentCredit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StudentCredit_schoolId_studentId_idx" ON "StudentCredit"("schoolId", "studentId");

ALTER TABLE "StudentCredit" ADD CONSTRAINT "StudentCredit_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
