-- AlterEnum
ALTER TYPE "FilePurpose" ADD VALUE 'STUDENT_PHOTO';

-- AlterTable
ALTER TABLE "Student" ADD COLUMN     "photoFileId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Student_photoFileId_key" ON "Student"("photoFileId");

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_photoFileId_fkey" FOREIGN KEY ("photoFileId") REFERENCES "StoredFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

