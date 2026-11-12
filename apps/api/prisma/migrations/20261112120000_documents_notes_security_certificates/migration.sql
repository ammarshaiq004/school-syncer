-- More certificate types.
ALTER TYPE "CertificateType" ADD VALUE 'BIRTH';
ALTER TYPE "CertificateType" ADD VALUE 'STUDY';
ALTER TYPE "CertificateType" ADD VALUE 'PROVISIONAL';
ALTER TYPE "CertificateType" ADD VALUE 'SPORTS';
ALTER TYPE "CertificateType" ADD VALUE 'APPRECIATION';
ALTER TYPE "CertificateType" ADD VALUE 'WARNING';

-- Student documents and notes.
ALTER TYPE "FilePurpose" ADD VALUE 'STUDENT_DOCUMENT';

ALTER TABLE "School" ADD COLUMN "documentTypes" TEXT[] NOT NULL DEFAULT ARRAY['Birth certificate / B-Form', 'Previous school leaving certificate', 'Previous report card', 'Guardian CNIC copy', 'Medical record', 'Other']::TEXT[];

CREATE TABLE "StudentNote" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentNote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StudentNote_studentId_createdAt_idx" ON "StudentNote"("studentId", "createdAt");
ALTER TABLE "StudentNote" ADD CONSTRAINT "StudentNote_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "StudentDocument" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentDocument_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StudentDocument_fileId_key" ON "StudentDocument"("fileId");
CREATE INDEX "StudentDocument_studentId_idx" ON "StudentDocument"("studentId");
ALTER TABLE "StudentDocument" ADD CONSTRAINT "StudentDocument_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudentDocument" ADD CONSTRAINT "StudentDocument_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "StoredFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Staff security fee: a deduction held and owed back, with a running balance per employee.
ALTER TABLE "StaffPayItem" ADD COLUMN "isSecurity" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "StaffSecurityEntry" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "note" TEXT,
    "payslipId" TEXT,
    "effectiveOn" DATE NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffSecurityEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StaffSecurityEntry_payslipId_key" ON "StaffSecurityEntry"("payslipId");
CREATE INDEX "StaffSecurityEntry_schoolId_userId_idx" ON "StaffSecurityEntry"("schoolId", "userId");
ALTER TABLE "StaffSecurityEntry" ADD CONSTRAINT "StaffSecurityEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
