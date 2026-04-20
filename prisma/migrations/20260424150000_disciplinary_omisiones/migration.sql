-- Disciplinario: fechas individuales de omisión por apercibimiento.
-- Una celda del Excel puede traer múltiples fechas; se desnormalizan en esta tabla.

CREATE TABLE "disciplinary_omisiones" (
    "id"               TEXT         NOT NULL,
    "apercibimientoId" TEXT         NOT NULL,
    "fecha"            TIMESTAMP(3) NOT NULL,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "disciplinary_omisiones_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "disciplinary_omisiones_apercibimientoId_fecha_key"
    ON "disciplinary_omisiones"("apercibimientoId", "fecha");

CREATE INDEX "disciplinary_omisiones_fecha_idx"
    ON "disciplinary_omisiones"("fecha");

ALTER TABLE "disciplinary_omisiones"
    ADD CONSTRAINT "disciplinary_omisiones_apercibimientoId_fkey"
    FOREIGN KEY ("apercibimientoId")
    REFERENCES "disciplinary_apercibimientos"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
