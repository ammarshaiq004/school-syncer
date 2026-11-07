-- QR attendance: scan time on student and staff marks, and the school's late cut-off.
ALTER TABLE "AttendanceRecord" ADD COLUMN "scannedAt" TIMESTAMP(3);
ALTER TABLE "StaffAttendance" ADD COLUMN "scannedAt" TIMESTAMP(3);
ALTER TABLE "School" ADD COLUMN "attendanceLateAfter" TEXT NOT NULL DEFAULT '08:30';
