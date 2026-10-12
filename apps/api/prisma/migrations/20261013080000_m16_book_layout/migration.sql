-- CreateEnum
CREATE TYPE "BookLayout" AS ENUM ('SINGLE', 'MIXED', 'COLLAGE');

-- AlterTable
ALTER TABLE "PhotoBook" ADD COLUMN     "layout" "BookLayout" NOT NULL DEFAULT 'MIXED';

