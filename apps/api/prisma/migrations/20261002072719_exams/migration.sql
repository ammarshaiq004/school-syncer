-- CreateEnum
CREATE TYPE "ExamStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateTable
CREATE TABLE "GradeBand" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "grade" TEXT NOT NULL,
    "minPercent" DOUBLE PRECISION NOT NULL,
    "remark" TEXT,

    CONSTRAINT "GradeBand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Exam" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startsOn" DATE,
    "endsOn" DATE,
    "status" "ExamStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Exam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamPaper" (
    "id" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "maxMarks" DOUBLE PRECISION NOT NULL,
    "passMarks" DOUBLE PRECISION NOT NULL,
    "date" DATE,

    CONSTRAINT "ExamPaper_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mark" (
    "id" TEXT NOT NULL,
    "paperId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "marks" DOUBLE PRECISION,
    "isAbsent" BOOLEAN NOT NULL DEFAULT false,
    "enteredById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Mark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamResult" (
    "id" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "obtained" DOUBLE PRECISION NOT NULL,
    "maxTotal" DOUBLE PRECISION NOT NULL,
    "percent" DOUBLE PRECISION NOT NULL,
    "grade" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "subjects" JSONB NOT NULL,
    "teacherRemark" TEXT,
    "principalRemark" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExamResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GradeBand_schoolId_grade_key" ON "GradeBand"("schoolId", "grade");

-- CreateIndex
CREATE INDEX "Exam_schoolId_idx" ON "Exam"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "Exam_academicYearId_name_key" ON "Exam"("academicYearId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ExamPaper_examId_classId_subjectId_key" ON "ExamPaper"("examId", "classId", "subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "Mark_paperId_studentId_key" ON "Mark"("paperId", "studentId");

-- CreateIndex
CREATE INDEX "ExamResult_sectionId_idx" ON "ExamResult"("sectionId");

-- CreateIndex
CREATE UNIQUE INDEX "ExamResult_examId_studentId_key" ON "ExamResult"("examId", "studentId");

-- AddForeignKey
ALTER TABLE "GradeBand" ADD CONSTRAINT "GradeBand_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exam" ADD CONSTRAINT "Exam_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exam" ADD CONSTRAINT "Exam_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamPaper" ADD CONSTRAINT "ExamPaper_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamPaper" ADD CONSTRAINT "ExamPaper_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamPaper" ADD CONSTRAINT "ExamPaper_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mark" ADD CONSTRAINT "Mark_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "ExamPaper"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mark" ADD CONSTRAINT "Mark_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamResult" ADD CONSTRAINT "ExamResult_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamResult" ADD CONSTRAINT "ExamResult_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamResult" ADD CONSTRAINT "ExamResult_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE CASCADE ON UPDATE CASCADE;
