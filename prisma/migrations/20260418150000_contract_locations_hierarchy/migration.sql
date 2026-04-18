-- Ubicaciones → Puestos → Turnos (horas)

CREATE TABLE "contract_locations" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_locations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "position_shifts" (
    "id" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "label" TEXT,
    "hours" DECIMAL(6,2) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "position_shifts_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "contract_locations" ADD CONSTRAINT "contract_locations_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "positions" ADD COLUMN "locationId" TEXT;

INSERT INTO "contract_locations" ("id", "contractId", "name", "description", "sortOrder", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, cp."contractId", 'Ubicación general', NULL, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "contractId" FROM "positions") cp;

UPDATE "positions" p
SET "locationId" = cl."id"
FROM "contract_locations" cl
WHERE p."contractId" = cl."contractId";

INSERT INTO "position_shifts" ("id", "positionId", "label", "hours", "sortOrder", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, p."id", trim(p."shift"), 8.0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "positions" p
WHERE p."shift" IS NOT NULL AND trim(p."shift") <> '';

ALTER TABLE "positions" DROP CONSTRAINT IF EXISTS "positions_contractId_fkey";

ALTER TABLE "positions" DROP COLUMN "shift",
DROP COLUMN "location",
DROP COLUMN "contractId";

ALTER TABLE "positions" ALTER COLUMN "locationId" SET NOT NULL;

CREATE INDEX "contract_locations_contractId_idx" ON "contract_locations"("contractId");

CREATE INDEX "positions_locationId_idx" ON "positions"("locationId");

CREATE INDEX "position_shifts_positionId_idx" ON "position_shifts"("positionId");

ALTER TABLE "positions" ADD CONSTRAINT "positions_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "contract_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "position_shifts" ADD CONSTRAINT "position_shifts_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "positions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
