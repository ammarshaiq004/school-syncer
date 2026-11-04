-- CreateTable
CREATE TABLE "SchoolDeletion" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "schoolName" TEXT NOT NULL,
    "schoolSlug" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "priorStatus" "SubscriptionStatus" NOT NULL,
    "restoredAt" TIMESTAMP(3),
    "restoredBy" TEXT,
    "purgedAt" TIMESTAMP(3),
    "purgeError" TEXT,
    "exportKey" TEXT,
    "exportSize" INTEGER,
    "exportExpiresAt" TIMESTAMP(3),

    CONSTRAINT "SchoolDeletion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SchoolDeletion_schoolId_idx" ON "SchoolDeletion"("schoolId");

-- CreateIndex
CREATE INDEX "SchoolDeletion_dueAt_idx" ON "SchoolDeletion"("dueAt");

