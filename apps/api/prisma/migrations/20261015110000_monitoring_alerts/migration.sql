-- AlterTable
ALTER TABLE "PlatformAdmin" ADD COLUMN     "phone" TEXT;

-- CreateTable
CREATE TABLE "PlatformAlert" (
    "key" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'warning',
    "summary" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastNotifiedAt" TIMESTAMP(3),
    "notifications" INTEGER NOT NULL DEFAULT 0,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "PlatformAlert_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "PlatformAlert_resolvedAt_idx" ON "PlatformAlert"("resolvedAt");

-- CreateIndex
CREATE INDEX "Job_queue_status_finishedAt_idx" ON "Job"("queue", "status", "finishedAt");

-- CreateIndex
CREATE INDEX "NotificationLog_createdAt_status_idx" ON "NotificationLog"("createdAt", "status");

