-- Módulo disciplinario: importación de apercibimientos y tratamiento desde Excel.

-- Enums
CREATE TYPE "DisciplinaryStatus" AS ENUM ('EMITIDO', 'ENTREGADO', 'FIRMADO', 'ANULADO');
CREATE TYPE "DisciplinaryVigencia" AS ENUM ('VIGENTE', 'VENCIDO', 'PRESCRITO', 'FINALIZADO', 'ANULADO');
CREATE TYPE "DisciplinaryCycleAccion" AS ENUM ('COBRADO', 'DADO_DE_BAJA', 'OTRO');

-- Lote de importación
CREATE TABLE "disciplinary_import_batches" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "rowsHistorial" INTEGER NOT NULL DEFAULT 0,
    "rowsTratamiento" INTEGER NOT NULL DEFAULT 0,
    "rowsInserted" INTEGER NOT NULL DEFAULT 0,
    "rowsUpdated" INTEGER NOT NULL DEFAULT 0,
    "rowsSkipped" INTEGER NOT NULL DEFAULT 0,
    "errorsJson" JSONB,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "disciplinary_import_batches_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "disciplinary_import_batches_createdAt_idx" ON "disciplinary_import_batches"("createdAt");
ALTER TABLE "disciplinary_import_batches"
    ADD CONSTRAINT "disciplinary_import_batches_uploadedById_fkey"
    FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Apercibimientos
CREATE TABLE "disciplinary_apercibimientos" (
    "id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "fechaEmision" TIMESTAMP(3) NOT NULL,
    "codigoEmpleado" TEXT NOT NULL,
    "codigoEmpleadoRaw" TEXT,
    "nombreEmpleado" TEXT NOT NULL,
    "zona" TEXT,
    "sucursal" TEXT,
    "cantidadOmisiones" INTEGER NOT NULL DEFAULT 0,
    "administrador" TEXT,
    "correoEnviadoA" TEXT,
    "rutaPdf" TEXT,
    "estado" "DisciplinaryStatus" NOT NULL DEFAULT 'EMITIDO',
    "vigencia" "DisciplinaryVigencia" NOT NULL DEFAULT 'VIGENTE',
    "batchExterno" TEXT,
    "plantilla" TEXT,
    "planoOrigen" TEXT,
    "motivoAnulacion" TEXT,
    "evidenciaAnulacion" TEXT,
    "importBatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "disciplinary_apercibimientos_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "disciplinary_apercibimientos_numero_key" ON "disciplinary_apercibimientos"("numero");
CREATE INDEX "disciplinary_apercibimientos_codigoEmpleado_fechaEmision_idx" ON "disciplinary_apercibimientos"("codigoEmpleado", "fechaEmision");
CREATE INDEX "disciplinary_apercibimientos_fechaEmision_idx" ON "disciplinary_apercibimientos"("fechaEmision");
CREATE INDEX "disciplinary_apercibimientos_administrador_idx" ON "disciplinary_apercibimientos"("administrador");
CREATE INDEX "disciplinary_apercibimientos_estado_idx" ON "disciplinary_apercibimientos"("estado");
CREATE INDEX "disciplinary_apercibimientos_vigencia_idx" ON "disciplinary_apercibimientos"("vigencia");
ALTER TABLE "disciplinary_apercibimientos"
    ADD CONSTRAINT "disciplinary_apercibimientos_importBatchId_fkey"
    FOREIGN KEY ("importBatchId") REFERENCES "disciplinary_import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Tratamiento por empleado
CREATE TABLE "disciplinary_treatments" (
    "id" TEXT NOT NULL,
    "codigoEmpleado" TEXT NOT NULL,
    "codigoEmpleadoRaw" TEXT,
    "nombre" TEXT,
    "zona" TEXT,
    "fechaConvocatoria" TIMESTAMP(3),
    "accion" TEXT,
    "cobradoDate" TIMESTAMP(3),
    "importBatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "disciplinary_treatments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "disciplinary_treatments_codigoEmpleado_key" ON "disciplinary_treatments"("codigoEmpleado");
CREATE INDEX "disciplinary_treatments_codigoEmpleado_idx" ON "disciplinary_treatments"("codigoEmpleado");
ALTER TABLE "disciplinary_treatments"
    ADD CONSTRAINT "disciplinary_treatments_importBatchId_fkey"
    FOREIGN KEY ("importBatchId") REFERENCES "disciplinary_import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Ciclos cerrados (uno por elemento del closed_cycles_json del Excel)
CREATE TABLE "disciplinary_closed_cycles" (
    "id" TEXT NOT NULL,
    "treatmentId" TEXT NOT NULL,
    "cerradoEl" TIMESTAMP(3),
    "accion" "DisciplinaryCycleAccion" NOT NULL DEFAULT 'OTRO',
    "accionRaw" TEXT,
    "monto" DECIMAL(14,2),
    "count" INTEGER,
    "omissions" INTEGER,
    "lastDate" TIMESTAMP(3),
    "fechaConvocatoria" TIMESTAMP(3),
    "nombre" TEXT,
    "zona" TEXT,
    "raw" JSONB NOT NULL,
    CONSTRAINT "disciplinary_closed_cycles_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "disciplinary_closed_cycles_treatmentId_idx" ON "disciplinary_closed_cycles"("treatmentId");
CREATE INDEX "disciplinary_closed_cycles_cerradoEl_idx" ON "disciplinary_closed_cycles"("cerradoEl");
CREATE INDEX "disciplinary_closed_cycles_accion_idx" ON "disciplinary_closed_cycles"("accion");
ALTER TABLE "disciplinary_closed_cycles"
    ADD CONSTRAINT "disciplinary_closed_cycles_treatmentId_fkey"
    FOREIGN KEY ("treatmentId") REFERENCES "disciplinary_treatments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
