-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('IN_STOCK', 'ASSIGNED', 'RETIRED');

-- CreateEnum
CREATE TYPE "AssetMovementType" AS ENUM ('INTAKE', 'ISSUE', 'ASSIGN', 'RETURN');

-- CreateEnum
CREATE TYPE "AssetIntakeReason" AS ENUM ('PURCHASE', 'RETURN', 'INITIAL', 'OTHER');

-- CreateEnum
CREATE TYPE "AssetIssueReason" AS ENUM ('LOST', 'DAMAGED', 'DISPOSED', 'OTHER');

-- AlterTable: phoneLine in positions
ALTER TABLE "positions" ADD COLUMN "phoneLine" TEXT;

-- CreateTable: asset_types
CREATE TABLE "asset_types" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fields" JSONB NOT NULL DEFAULT '[]',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asset_types_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "asset_types_code_key" ON "asset_types"("code");

-- CreateTable: assets
CREATE TABLE "assets" (
    "id" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT,
    "brand" TEXT,
    "model" TEXT,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "status" "AssetStatus" NOT NULL DEFAULT 'IN_STOCK',
    "currentPositionId" TEXT,
    "acquisitionExpenseId" TEXT,
    "acquisitionDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "assets_typeId_code_key" ON "assets"("typeId", "code");
CREATE INDEX "assets_status_idx" ON "assets"("status");
CREATE INDEX "assets_currentPositionId_idx" ON "assets"("currentPositionId");
CREATE INDEX "assets_typeId_idx" ON "assets"("typeId");

-- CreateTable: asset_movements
CREATE TABLE "asset_movements" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "type" "AssetMovementType" NOT NULL,
    "fromPositionId" TEXT,
    "toPositionId" TEXT,
    "expenseId" TEXT,
    "intakeReason" "AssetIntakeReason",
    "issueReason" "AssetIssueReason",
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_movements_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "asset_movements_assetId_idx" ON "asset_movements"("assetId");
CREATE INDEX "asset_movements_type_idx" ON "asset_movements"("type");
CREATE INDEX "asset_movements_createdAt_idx" ON "asset_movements"("createdAt");

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "asset_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "assets" ADD CONSTRAINT "assets_currentPositionId_fkey" FOREIGN KEY ("currentPositionId") REFERENCES "positions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "assets" ADD CONSTRAINT "assets_acquisitionExpenseId_fkey" FOREIGN KEY ("acquisitionExpenseId") REFERENCES "expenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "asset_movements" ADD CONSTRAINT "asset_movements_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "asset_movements" ADD CONSTRAINT "asset_movements_fromPositionId_fkey" FOREIGN KEY ("fromPositionId") REFERENCES "positions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "asset_movements" ADD CONSTRAINT "asset_movements_toPositionId_fkey" FOREIGN KEY ("toPositionId") REFERENCES "positions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "asset_movements" ADD CONSTRAINT "asset_movements_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "expenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed default asset types (so Mantenimientos has something immediately)
INSERT INTO "asset_types" ("id", "code", "name", "fields", "isActive", "sortOrder", "updatedAt") VALUES
  ('asset_type_phone', 'PHONE', 'Celular',
   '[{"key":"imei","label":"IMEI","type":"string","required":false},{"key":"numero","label":"Número","type":"string","required":false}]'::jsonb,
   true, 0, CURRENT_TIMESTAMP),
  ('asset_type_radio', 'RADIO', 'Radio',
   '[{"key":"frecuencia","label":"Frecuencia","type":"string","required":false},{"key":"canal","label":"Canal","type":"string","required":false}]'::jsonb,
   true, 1, CURRENT_TIMESTAMP),
  ('asset_type_weapon', 'WEAPON', 'Arma',
   '[{"key":"calibre","label":"Calibre","type":"string","required":false},{"key":"permiso","label":"N° Permiso","type":"string","required":false}]'::jsonb,
   true, 2, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
