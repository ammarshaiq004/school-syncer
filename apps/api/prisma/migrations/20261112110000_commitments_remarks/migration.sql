-- Promise-to-pay commitments and a fee remark per student.
ALTER TABLE "Student" ADD COLUMN "feeRemark" TEXT;

CREATE TABLE "FeeCommitment" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "promisedOn" DATE NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "FeeCommitment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FeeCommitment_schoolId_promisedOn_idx" ON "FeeCommitment"("schoolId", "promisedOn");
CREATE INDEX "FeeCommitment_studentId_idx" ON "FeeCommitment"("studentId");

ALTER TABLE "FeeCommitment" ADD CONSTRAINT "FeeCommitment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
