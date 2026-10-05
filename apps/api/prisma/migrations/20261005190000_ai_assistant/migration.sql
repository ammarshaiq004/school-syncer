-- CreateEnum
CREATE TYPE "AssistantKind" AS ENUM ('ASK', 'DRAFT');

-- CreateTable
CREATE TABLE "AssistantUsage" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "AssistantKind" NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssistantUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssistantUsage_userId_createdAt_idx" ON "AssistantUsage"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AssistantUsage_schoolId_createdAt_idx" ON "AssistantUsage"("schoolId", "createdAt");

-- AddForeignKey
ALTER TABLE "AssistantUsage" ADD CONSTRAINT "AssistantUsage_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The AI assistant is a Growth and Enterprise feature (DEFAULT_PLANS in src/platform/plans.ts).
UPDATE "Plan" SET "features" = array_append("features", 'ai_assistant'), "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" IN ('growth', 'enterprise') AND NOT ('ai_assistant' = ANY("features"));
