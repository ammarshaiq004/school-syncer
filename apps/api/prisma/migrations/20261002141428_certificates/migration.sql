-- CreateEnum
CREATE TYPE "CertificateType" AS ENUM ('LEAVING', 'CHARACTER', 'ENROLMENT');

-- CreateTable
CREATE TABLE "Certificate" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "type" "CertificateType" NOT NULL,
    "serialNo" TEXT NOT NULL,
    "verifyCode" TEXT NOT NULL,
    "issuedOn" DATE NOT NULL,
    "details" JSONB NOT NULL,
    "issuedById" TEXT NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Certificate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Certificate_verifyCode_key" ON "Certificate"("verifyCode");

-- CreateIndex
CREATE INDEX "Certificate_schoolId_type_idx" ON "Certificate"("schoolId", "type");

-- CreateIndex
CREATE INDEX "Certificate_studentId_idx" ON "Certificate"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "Certificate_schoolId_serialNo_key" ON "Certificate"("schoolId", "serialNo");

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Certificates and ID cards are in every plan.
UPDATE "Plan" SET "features" = array_append("features", 'certificates')
WHERE "code" IN ('starter', 'growth', 'enterprise') AND NOT ('certificates' = ANY("features"));
