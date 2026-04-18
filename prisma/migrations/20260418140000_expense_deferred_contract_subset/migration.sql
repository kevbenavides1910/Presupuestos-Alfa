-- AlterTable
ALTER TABLE "expenses" ADD COLUMN "deferredIncludeContractIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
