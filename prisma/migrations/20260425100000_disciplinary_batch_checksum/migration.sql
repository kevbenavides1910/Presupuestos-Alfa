-- Agrega SHA-256 unique al batch de import disciplinario para rechazar archivos repetidos.
ALTER TABLE "disciplinary_import_batches"
    ADD COLUMN "checksum" TEXT;

CREATE UNIQUE INDEX "disciplinary_import_batches_checksum_key"
    ON "disciplinary_import_batches"("checksum");
