-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('WAITING', 'READY', 'FULFILLED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "WhatsappDirection" AS ENUM ('IN', 'OUT');

-- AlterTable
ALTER TABLE "NotificationLog" ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "readAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "BookReservation" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "studentId" TEXT,
    "userId" TEXT,
    "status" "ReservationStatus" NOT NULL DEFAULT 'WAITING',
    "copyId" TEXT,
    "holdUntil" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "BookReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageTemplate" (
    "schoolId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageTemplate_pkey" PRIMARY KEY ("schoolId","key")
);

-- CreateTable
CREATE TABLE "WhatsappMessage" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "direction" "WhatsappDirection" NOT NULL,
    "body" TEXT NOT NULL,
    "contactName" TEXT,
    "providerMessageId" TEXT,
    "readAt" TIMESTAMP(3),
    "sentById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsappMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BookReservation_schoolId_status_idx" ON "BookReservation"("schoolId", "status");

-- CreateIndex
CREATE INDEX "BookReservation_bookId_status_createdAt_idx" ON "BookReservation"("bookId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "WhatsappMessage_schoolId_phone_createdAt_idx" ON "WhatsappMessage"("schoolId", "phone", "createdAt");

-- CreateIndex
CREATE INDEX "WhatsappMessage_schoolId_direction_readAt_idx" ON "WhatsappMessage"("schoolId", "direction", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappMessage_schoolId_providerMessageId_key" ON "WhatsappMessage"("schoolId", "providerMessageId");

-- CreateIndex
CREATE INDEX "NotificationLog_providerMessageId_idx" ON "NotificationLog"("providerMessageId");

-- AddForeignKey
ALTER TABLE "BookReservation" ADD CONSTRAINT "BookReservation_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookReservation" ADD CONSTRAINT "BookReservation_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookReservation" ADD CONSTRAINT "BookReservation_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookReservation" ADD CONSTRAINT "BookReservation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageTemplate" ADD CONSTRAINT "MessageTemplate_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsappMessage" ADD CONSTRAINT "WhatsappMessage_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

