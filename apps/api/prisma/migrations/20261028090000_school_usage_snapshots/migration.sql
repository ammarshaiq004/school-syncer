-- CreateTable
CREATE TABLE "SchoolUsageSnapshot" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "students" INTEGER NOT NULL,
    "staffActive7d" INTEGER NOT NULL,
    "parentsActive7d" INTEGER NOT NULL,
    "attendanceSessions" INTEGER NOT NULL,
    "feesCollected" INTEGER NOT NULL,
    "messagesSent" INTEGER NOT NULL,
    "storageBytes" BIGINT NOT NULL,
    "mrr" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchoolUsageSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SchoolUsageSnapshot_day_idx" ON "SchoolUsageSnapshot"("day");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolUsageSnapshot_schoolId_day_key" ON "SchoolUsageSnapshot"("schoolId", "day");

-- AddForeignKey
ALTER TABLE "SchoolUsageSnapshot" ADD CONSTRAINT "SchoolUsageSnapshot_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

