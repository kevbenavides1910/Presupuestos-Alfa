-- Disciplinario: agrega columnas para contrato/licitación y cliente derivado.

ALTER TABLE "disciplinary_apercibimientos"
    ADD COLUMN "contrato"            TEXT,
    ADD COLUMN "contratoNormalizado" TEXT,
    ADD COLUMN "cliente"              TEXT,
    ADD COLUMN "clienteSetManual"     BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "disciplinary_apercibimientos_contratoNormalizado_idx"
    ON "disciplinary_apercibimientos"("contratoNormalizado");
