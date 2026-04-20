-- Permitir múltiples omisiones del mismo día por apercibimiento.
-- Quitamos el unique (apercibimientoId, fecha) y agregamos columna `secuencia`
-- para preservar el orden y permitir distinguir duplicados del mismo día.

ALTER TABLE "disciplinary_omisiones"
    ADD COLUMN "secuencia" INTEGER NOT NULL DEFAULT 0;

-- Drop del unique anterior (Prisma lo nombró ..._key).
DROP INDEX IF EXISTS "disciplinary_omisiones_apercibimientoId_fecha_key";

-- Recreamos como índice no único para mantener performance en lookups por (apercibimiento, fecha).
CREATE INDEX IF NOT EXISTS "disciplinary_omisiones_apercibimientoId_fecha_idx"
    ON "disciplinary_omisiones"("apercibimientoId", "fecha");
