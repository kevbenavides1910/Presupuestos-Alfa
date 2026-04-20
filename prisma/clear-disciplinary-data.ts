/**
 * Elimina TODOS los datos del módulo Disciplinario para volver a empezar las pruebas.
 *
 * Borra (en este orden, respetando FKs):
 *   - DisciplinaryOmission       (fechas de omisión por apercibimiento)
 *   - DisciplinaryClosedCycle    (ciclos cerrados por tratamiento)
 *   - DisciplinaryTreatment      (tratamiento/convocatoria por empleado)
 *   - DisciplinaryApercibimiento (apercibimientos)
 *   - DisciplinaryImportBatch    (historial de importaciones / checksums)
 *
 * NO borra usuarios, ni contratos, ni catálogos, ni nada fuera del módulo disciplinario.
 *
 * Uso local (desarrollo):
 *   npx ts-node prisma/clear-disciplinary-data.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Eliminando datos del módulo Disciplinario…");

  const before = {
    omisiones: await prisma.disciplinaryOmission.count(),
    closedCycles: await prisma.disciplinaryClosedCycle.count(),
    treatments: await prisma.disciplinaryTreatment.count(),
    apercibimientos: await prisma.disciplinaryApercibimiento.count(),
    batches: await prisma.disciplinaryImportBatch.count(),
  };

  await prisma.$transaction(async (tx) => {
    await tx.disciplinaryOmission.deleteMany();
    await tx.disciplinaryClosedCycle.deleteMany();
    await tx.disciplinaryTreatment.deleteMany();
    await tx.disciplinaryApercibimiento.deleteMany();
    await tx.disciplinaryImportBatch.deleteMany();
  });

  const after = {
    omisiones: await prisma.disciplinaryOmission.count(),
    closedCycles: await prisma.disciplinaryClosedCycle.count(),
    treatments: await prisma.disciplinaryTreatment.count(),
    apercibimientos: await prisma.disciplinaryApercibimiento.count(),
    batches: await prisma.disciplinaryImportBatch.count(),
  };

  console.log("Antes  →", before);
  console.log("Después →", after);
  console.log("Listo. Módulo disciplinario vacío y listo para pruebas.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
