-- Aon: per-school switch and token budget, the console's AI key, and school memory notes.
ALTER TABLE "School" ADD COLUMN "aonEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "aiMonthlyTokens" INTEGER;

CREATE TABLE "PlatformAiKey" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "sealed" TEXT NOT NULL,
    "hint" TEXT NOT NULL,
    "setById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformAiKey_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AonMemoryNote" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AonMemoryNote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AonMemoryNote_schoolId_createdAt_idx" ON "AonMemoryNote"("schoolId", "createdAt");

ALTER TABLE "AonMemoryNote" ADD CONSTRAINT "AonMemoryNote_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
