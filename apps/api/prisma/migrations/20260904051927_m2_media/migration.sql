-- AlterTable
ALTER TABLE "Media" ADD COLUMN     "processingError" TEXT;

-- AlterTable
ALTER TABLE "UploadSession" ADD COLUMN     "takenAtHint" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "UploadSession_expiresAt_idx" ON "UploadSession"("expiresAt");
