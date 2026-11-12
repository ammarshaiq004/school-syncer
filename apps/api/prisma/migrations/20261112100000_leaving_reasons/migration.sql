-- Why a student left, with remarks and the balance owed at that moment; reasons are set per school.
ALTER TABLE "Student" ADD COLUMN "leavingReason" TEXT, ADD COLUMN "leavingRemarks" TEXT, ADD COLUMN "leavingBalance" INTEGER;
ALTER TABLE "School" ADD COLUMN "leavingReasons" TEXT[] DEFAULT ARRAY['Fee Defaulter', 'Migration', 'Misbehaviour', 'Regular Absents', 'Duplicate Entry', 'Wrong Entry', 'Course Completed', 'Other']::TEXT[];
UPDATE "School" SET "leavingReasons" = ARRAY['Fee Defaulter', 'Migration', 'Misbehaviour', 'Regular Absents', 'Duplicate Entry', 'Wrong Entry', 'Course Completed', 'Other']::TEXT[] WHERE "leavingReasons" IS NULL;
ALTER TABLE "School" ALTER COLUMN "leavingReasons" SET NOT NULL;
