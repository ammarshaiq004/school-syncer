-- CreateTable
CREATE TABLE "SchoolSite" (
    "schoolId" TEXT NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolSite_pkey" PRIMARY KEY ("schoolId")
);

-- AddForeignKey
ALTER TABLE "SchoolSite" ADD CONSTRAINT "SchoolSite_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
