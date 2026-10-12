-- CreateEnum
CREATE TYPE "BookFormat" AS ENUM ('SQUARE_21', 'A4_LANDSCAPE', 'SQUARE_30');

-- CreateEnum
CREATE TYPE "BookTextMode" AS ENUM ('NONE', 'CAPTIONS', 'COMMENTS');

-- AlterTable
ALTER TABLE "FamilyMember" ADD COLUMN     "canCreateBooks" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Invite" ADD COLUMN     "canCreateBooks" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "PhotoBook" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "format" "BookFormat" NOT NULL,
    "textMode" "BookTextMode" NOT NULL,
    "months" TEXT[],
    "onlyCommented" BOOLEAN NOT NULL DEFAULT false,
    "pages" JSONB NOT NULL,
    "pageCount" INTEGER NOT NULL DEFAULT 0,
    "mediaCount" INTEGER NOT NULL DEFAULT 0,
    "status" "MediaStatus" NOT NULL DEFAULT 'PROCESSING',
    "error" TEXT,
    "pdfBytes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "renderedAt" TIMESTAMP(3),

    CONSTRAINT "PhotoBook_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PhotoBook_familyId_createdAt_idx" ON "PhotoBook"("familyId", "createdAt");

-- AddForeignKey
ALTER TABLE "PhotoBook" ADD CONSTRAINT "PhotoBook_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoBook" ADD CONSTRAINT "PhotoBook_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

