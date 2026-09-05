-- AlterTable
ALTER TABLE "Device" ADD COLUMN     "lastError" TEXT;

-- AlterTable
ALTER TABLE "Media" ADD COLUMN     "notifiedAt" TIMESTAMP(3);
