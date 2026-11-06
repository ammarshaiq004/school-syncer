-- Datesheets, roll number slips and syllabus: when, where and what each exam paper covers.
ALTER TABLE "ExamPaper" ADD COLUMN "startTime" TEXT,
ADD COLUMN "endTime" TEXT,
ADD COLUMN "room" TEXT,
ADD COLUMN "syllabus" TEXT;
