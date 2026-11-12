-- A school can link its own WhatsApp number by QR code (Evolution API) as a sender.
ALTER TABLE "SchoolMessagingSender" ADD COLUMN "linkEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SchoolMessagingSender" ADD COLUMN "linkedNumber" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SchoolMessagingSender" ADD COLUMN "linkedName" TEXT NOT NULL DEFAULT '';
