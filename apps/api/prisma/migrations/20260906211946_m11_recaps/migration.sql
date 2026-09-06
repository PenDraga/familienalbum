-- CreateEnum
CREATE TYPE "RecapKind" AS ENUM ('MONTH', 'YEAR', 'SECONDS');

-- CreateTable
CREATE TABLE "Recap" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "kind" "RecapKind" NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "title" TEXT NOT NULL,
    "status" "MediaStatus" NOT NULL DEFAULT 'PROCESSING',
    "error" TEXT,
    "durationSec" DOUBLE PRECISION,
    "mediaCount" INTEGER NOT NULL DEFAULT 0,
    "musicTrack" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readyAt" TIMESTAMP(3),

    CONSTRAINT "Recap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Recap_familyId_createdAt_idx" ON "Recap"("familyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Recap_familyId_kind_periodStart_key" ON "Recap"("familyId", "kind", "periodStart");

-- AddForeignKey
ALTER TABLE "Recap" ADD CONSTRAINT "Recap_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;

