-- Fotobuch: eigener Status (Entwurf → PDF wird erstellt → fertig). Erzeugt mit `prisma migrate diff`, die Spalte
-- wird hier aber umgewandelt statt gelöscht, damit bestehende Bücher ihren Stand behalten.

-- CreateEnum
CREATE TYPE "BookStatus" AS ENUM ('DRAFT', 'RENDERING', 'READY', 'FAILED');

-- AlterTable
ALTER TABLE "PhotoBook" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "PhotoBook" ALTER COLUMN "status" TYPE "BookStatus" USING (
  CASE "status"::text
    WHEN 'READY' THEN 'READY'
    WHEN 'FAILED' THEN 'FAILED'
    WHEN 'PROCESSING' THEN 'RENDERING'
    ELSE 'DRAFT'
  END
)::"BookStatus";
ALTER TABLE "PhotoBook" ALTER COLUMN "status" SET DEFAULT 'DRAFT';

-- Upload-Assistent: Beschreibung wird mit der Session übergeben
-- AlterTable
ALTER TABLE "UploadSession" ADD COLUMN     "caption" TEXT;
