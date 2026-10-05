-- CreateEnum
CREATE TYPE "FilePurpose" AS ENUM ('LESSON', 'ASSIGNMENT', 'SUBMISSION');

-- AlterTable
ALTER TABLE "Assignment" ADD COLUMN     "attachmentId" TEXT;

-- AlterTable
ALTER TABLE "Lesson" ADD COLUMN     "fileId" TEXT;

-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "maxStorageMb" INTEGER;

-- AlterTable
ALTER TABLE "Submission" ADD COLUMN     "fileId" TEXT;

-- CreateTable
CREATE TABLE "StoredFile" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "purpose" "FilePurpose" NOT NULL,
    "key" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoredFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StoredFile_key_key" ON "StoredFile"("key");

-- CreateIndex
CREATE INDEX "StoredFile_schoolId_idx" ON "StoredFile"("schoolId");

-- CreateIndex
CREATE INDEX "StoredFile_uploadedById_idx" ON "StoredFile"("uploadedById");

-- CreateIndex
CREATE UNIQUE INDEX "Assignment_attachmentId_key" ON "Assignment"("attachmentId");

-- CreateIndex
CREATE UNIQUE INDEX "Lesson_fileId_key" ON "Lesson"("fileId");

-- CreateIndex
CREATE UNIQUE INDEX "Submission_fileId_key" ON "Submission"("fileId");

-- AddForeignKey
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "StoredFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "StoredFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "StoredFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoredFile" ADD CONSTRAINT "StoredFile_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoredFile" ADD CONSTRAINT "StoredFile_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Storage per plan (kept in sync with DEFAULT_PLANS in src/platform/plans.ts).
UPDATE "Plan" SET "maxStorageMb" = 5120 WHERE "code" = 'starter';
UPDATE "Plan" SET "maxStorageMb" = 25600 WHERE "code" = 'growth';
UPDATE "Plan" SET "maxStorageMb" = 102400 WHERE "code" = 'enterprise';
