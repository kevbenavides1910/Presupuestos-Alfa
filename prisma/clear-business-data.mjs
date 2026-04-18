/**
 * Misma lógica que clear-business-data.ts, sin ts-node (útil en imagen Docker).
 *
 * Uso local: node prisma/clear-business-data.mjs
 * Docker:    docker compose -f docker-compose.prod.yml exec app node prisma/clear-business-data.mjs
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Eliminando datos de negocio…");

  await prisma.$transaction(async (tx) => {
    await tx.expenseDistribution.deleteMany();
    await tx.expense.deleteMany();
    await tx.adminDistribution.deleteMany();
    await tx.adminExpense.deleteMany();
    await tx.deferredDistribution.deleteMany();
    await tx.deferredExpense.deleteMany();
    await tx.uniformExpense.deleteMany();
    await tx.auditFinding.deleteMany();
    await tx.billingHistory.deleteMany();
    await tx.contractPeriod.deleteMany();
    await tx.positionShift.deleteMany();
    await tx.position.deleteMany();
    await tx.contractLocation.deleteMany();
    await tx.auditLog.deleteMany();
    await tx.contract.deleteMany();
  });

  const remaining = await prisma.contract.count();
  const expenses = await prisma.expense.count();
  console.log(`Listo. Contratos: ${remaining}, Gastos unificados: ${expenses}. Usuarios y catálogos sin cambios.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
