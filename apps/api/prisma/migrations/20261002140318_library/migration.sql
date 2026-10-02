-- CreateEnum
CREATE TYPE "CopyStatus" AS ENUM ('AVAILABLE', 'ON_LOAN', 'LOST', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "FineStatus" AS ENUM ('NONE', 'DUE', 'PAID', 'BILLED', 'WAIVED');

-- AlterTable
ALTER TABLE "School" ADD COLUMN     "libraryFinePerDay" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "libraryLoanDays" INTEGER NOT NULL DEFAULT 14,
ADD COLUMN     "libraryMaxLoans" INTEGER NOT NULL DEFAULT 2;

-- CreateTable
CREATE TABLE "Book" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "author" TEXT,
    "isbn" TEXT,
    "publisher" TEXT,
    "category" TEXT,
    "language" TEXT NOT NULL DEFAULT 'English',
    "shelf" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Book_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookCopy" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "accessionNo" TEXT NOT NULL,
    "campusId" TEXT,
    "status" "CopyStatus" NOT NULL DEFAULT 'AVAILABLE',
    "addedOn" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookCopy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookLoan" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "copyId" TEXT NOT NULL,
    "studentId" TEXT,
    "userId" TEXT,
    "issuedOn" DATE NOT NULL,
    "dueOn" DATE NOT NULL,
    "returnedOn" DATE,
    "lost" BOOLEAN NOT NULL DEFAULT false,
    "fine" INTEGER NOT NULL DEFAULT 0,
    "fineStatus" "FineStatus" NOT NULL DEFAULT 'NONE',
    "invoiceId" TEXT,
    "issuedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookLoan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Book_schoolId_title_idx" ON "Book"("schoolId", "title");

-- CreateIndex
CREATE UNIQUE INDEX "BookCopy_schoolId_accessionNo_key" ON "BookCopy"("schoolId", "accessionNo");

-- CreateIndex
CREATE INDEX "BookLoan_schoolId_returnedOn_idx" ON "BookLoan"("schoolId", "returnedOn");

-- CreateIndex
CREATE INDEX "BookLoan_studentId_idx" ON "BookLoan"("studentId");

-- CreateIndex
CREATE INDEX "BookLoan_userId_idx" ON "BookLoan"("userId");

-- AddForeignKey
ALTER TABLE "Book" ADD CONSTRAINT "Book_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookCopy" ADD CONSTRAINT "BookCopy_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookCopy" ADD CONSTRAINT "BookCopy_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "Campus"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookLoan" ADD CONSTRAINT "BookLoan_copyId_fkey" FOREIGN KEY ("copyId") REFERENCES "BookCopy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookLoan" ADD CONSTRAINT "BookLoan_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookLoan" ADD CONSTRAINT "BookLoan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookLoan" ADD CONSTRAINT "BookLoan_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The library is part of the Growth and Enterprise plans.
UPDATE "Plan" SET "features" = array_append("features", 'library')
WHERE "code" IN ('growth', 'enterprise') AND NOT ('library' = ANY("features"));
