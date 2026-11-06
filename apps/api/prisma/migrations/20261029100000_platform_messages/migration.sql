-- CreateEnum
CREATE TYPE "PlatformMessageTarget" AS ENUM ('ALL', 'CHOSEN', 'OVERDUE', 'TRIALS_ENDING');

-- CreateEnum
CREATE TYPE "PlatformMessageAudience" AS ENUM ('OWNERS', 'STAFF');

-- CreateTable
CREATE TABLE "PlatformMessage" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "severity" "PlatformNoticeSeverity" NOT NULL DEFAULT 'INFO',
    "target" "PlatformMessageTarget" NOT NULL,
    "audience" "PlatformMessageAudience" NOT NULL,
    "schoolIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "schools" INTEGER NOT NULL,
    "sentBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlatformMessage_createdAt_idx" ON "PlatformMessage"("createdAt");

