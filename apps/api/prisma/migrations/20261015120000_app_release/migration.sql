-- CreateEnum
CREATE TYPE "AppPlatform" AS ENUM ('IOS', 'ANDROID');

-- CreateTable
CREATE TABLE "AppRelease" (
    "platform" "AppPlatform" NOT NULL,
    "minVersion" TEXT NOT NULL,
    "latestVersion" TEXT NOT NULL,
    "storeUrl" TEXT NOT NULL DEFAULT '',
    "message" TEXT NOT NULL DEFAULT '',
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppRelease_pkey" PRIMARY KEY ("platform")
);
