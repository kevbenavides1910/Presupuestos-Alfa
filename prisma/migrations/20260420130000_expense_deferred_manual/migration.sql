-- AlterTable
ALTER TABLE "expenses" ADD COLUMN "deferredManualDistribution" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "expenses" ADD COLUMN "deferredManualAllocations" JSONB;
