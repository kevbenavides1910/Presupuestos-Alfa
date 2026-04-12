import { PrismaClient, CompanyName, ClientType, ContractStatus, UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const COMPANIES: CompanyName[] = [
  "CONSORCIO", "MONITOREO", "TANGO", "ALFA",
  "ALFATRONIC", "BENLO", "BENA", "JOBEN", "GRUPO", "ACE",
];

// Sample contracts per company (represents real ~90 contracts across group)
const SAMPLE_CONTRACTS = [
  // CONSORCIO
  { licitacionNo: "LIC-CCSS-001-2023", company: "CONSORCIO" as CompanyName, client: "CCSS - Hospital México", clientType: "PUBLIC" as ClientType, officersCount: 45, positionsCount: 22, monthlyBilling: 18500000, suppliesBudgetPct: 0.08, status: "ACTIVE" as ContractStatus, startDate: new Date("2023-01-01"), endDate: new Date("2026-12-31") },
  { licitacionNo: "LIC-CCSS-002-2023", company: "CONSORCIO" as CompanyName, client: "CCSS - Hospital San Juan de Dios", clientType: "PUBLIC" as ClientType, officersCount: 38, positionsCount: 18, monthlyBilling: 15200000, suppliesBudgetPct: 0.07, status: "ACTIVE" as ContractStatus, startDate: new Date("2023-03-01"), endDate: new Date("2026-02-28") },
  { licitacionNo: "LIC-UCR-001-2022", company: "CONSORCIO" as CompanyName, client: "Universidad de Costa Rica", clientType: "PUBLIC" as ClientType, officersCount: 55, positionsCount: 28, monthlyBilling: 22000000, suppliesBudgetPct: 0.09, status: "ACTIVE" as ContractStatus, startDate: new Date("2022-08-01"), endDate: new Date("2025-07-31") },
  { licitacionNo: "LIC-PRIV-001-2024", company: "CONSORCIO" as CompanyName, client: "Banco BAC San José", clientType: "PRIVATE" as ClientType, officersCount: 12, positionsCount: 6, monthlyBilling: 4800000, suppliesBudgetPct: 0.06, status: "ACTIVE" as ContractStatus, startDate: new Date("2024-01-01"), endDate: new Date("2024-12-31") },

  // MONITOREO
  { licitacionNo: "LIC-ICE-001-2023", company: "MONITOREO" as CompanyName, client: "ICE - Sede Central", clientType: "PUBLIC" as ClientType, officersCount: 20, positionsCount: 10, monthlyBilling: 8200000, suppliesBudgetPct: 0.07, status: "ACTIVE" as ContractStatus, startDate: new Date("2023-06-01"), endDate: new Date("2026-05-31") },
  { licitacionNo: "LIC-INA-001-2022", company: "MONITOREO" as CompanyName, client: "INA - Sede Heredia", clientType: "PUBLIC" as ClientType, officersCount: 15, positionsCount: 7, monthlyBilling: 6000000, suppliesBudgetPct: 0.08, status: "ACTIVE" as ContractStatus, startDate: new Date("2022-10-01"), endDate: new Date("2025-09-30") },
  { licitacionNo: "LIC-PRIV-002-2023", company: "MONITOREO" as CompanyName, client: "Mall San Pedro", clientType: "PRIVATE" as ClientType, officersCount: 25, positionsCount: 12, monthlyBilling: 9500000, suppliesBudgetPct: 0.06, status: "ACTIVE" as ContractStatus, startDate: new Date("2023-01-01"), endDate: new Date("2025-12-31") },

  // TANGO
  { licitacionNo: "LIC-PJ-001-2024", company: "TANGO" as CompanyName, client: "Poder Judicial - OIJ", clientType: "PUBLIC" as ClientType, officersCount: 60, positionsCount: 30, monthlyBilling: 24000000, suppliesBudgetPct: 0.10, status: "ACTIVE" as ContractStatus, startDate: new Date("2024-01-01"), endDate: new Date("2027-12-31") },
  { licitacionNo: "LIC-UCR-002-2023", company: "TANGO" as CompanyName, client: "UCR - Ciudad Universitaria", clientType: "PUBLIC" as ClientType, officersCount: 30, positionsCount: 14, monthlyBilling: 11500000, suppliesBudgetPct: 0.08, status: "ACTIVE" as ContractStatus, startDate: new Date("2023-07-01"), endDate: new Date("2026-06-30") },
  { licitacionNo: "LIC-PRIV-003-2024", company: "TANGO" as CompanyName, client: "Almacenes El Rey", clientType: "PRIVATE" as ClientType, officersCount: 18, positionsCount: 9, monthlyBilling: 7200000, suppliesBudgetPct: 0.07, status: "ACTIVE" as ContractStatus, startDate: new Date("2024-02-01"), endDate: new Date("2025-01-31") },

  // ALFA
  { licitacionNo: "LIC-CCSS-003-2022", company: "ALFA" as CompanyName, client: "CCSS - CENDEISSS", clientType: "PUBLIC" as ClientType, officersCount: 35, positionsCount: 16, monthlyBilling: 13500000, suppliesBudgetPct: 0.08, status: "ACTIVE" as ContractStatus, startDate: new Date("2022-11-01"), endDate: new Date("2025-10-31") },
  { licitacionNo: "LIC-ICE-002-2023", company: "ALFA" as CompanyName, client: "ICE - Planta Garita", clientType: "PUBLIC" as ClientType, officersCount: 40, positionsCount: 20, monthlyBilling: 16000000, suppliesBudgetPct: 0.09, status: "ACTIVE" as ContractStatus, startDate: new Date("2023-04-01"), endDate: new Date("2026-03-31") },
  { licitacionNo: "LIC-MUNI-001-2023", company: "ALFA" as CompanyName, client: "Municipalidad de San José", clientType: "PUBLIC" as ClientType, officersCount: 22, positionsCount: 11, monthlyBilling: 8800000, suppliesBudgetPct: 0.07, status: "ACTIVE" as ContractStatus, startDate: new Date("2023-02-01"), endDate: new Date("2025-01-31") },

  // ALFATRONIC
  { licitacionNo: "LIC-INA-002-2024", company: "ALFATRONIC" as CompanyName, client: "INA - Sede Alajuela", clientType: "PUBLIC" as ClientType, officersCount: 18, positionsCount: 9, monthlyBilling: 7200000, suppliesBudgetPct: 0.08, status: "ACTIVE" as ContractStatus, startDate: new Date("2024-01-01"), endDate: new Date("2026-12-31") },
  { licitacionNo: "LIC-PRIV-004-2023", company: "ALFATRONIC" as CompanyName, client: "Corporación BCR", clientType: "PRIVATE" as ClientType, officersCount: 28, positionsCount: 14, monthlyBilling: 11200000, suppliesBudgetPct: 0.06, status: "ACTIVE" as ContractStatus, startDate: new Date("2023-09-01"), endDate: new Date("2025-08-31") },
  { licitacionNo: "LIC-UCR-003-2024", company: "ALFATRONIC" as CompanyName, client: "UCR - SIBDI", clientType: "PUBLIC" as ClientType, officersCount: 14, positionsCount: 7, monthlyBilling: 5600000, suppliesBudgetPct: 0.07, status: "ACTIVE" as ContractStatus, startDate: new Date("2024-03-01"), endDate: new Date("2027-02-28") },

  // BENLO
  { licitacionNo: "LIC-PJ-002-2023", company: "BENLO" as CompanyName, client: "Poder Judicial - TSE", clientType: "PUBLIC" as ClientType, officersCount: 42, positionsCount: 20, monthlyBilling: 16800000, suppliesBudgetPct: 0.09, status: "ACTIVE" as ContractStatus, startDate: new Date("2023-05-01"), endDate: new Date("2026-04-30") },
  { licitacionNo: "LIC-MUNI-002-2024", company: "BENLO" as CompanyName, client: "Municipalidad de Alajuela", clientType: "PUBLIC" as ClientType, officersCount: 16, positionsCount: 8, monthlyBilling: 6400000, suppliesBudgetPct: 0.07, status: "ACTIVE" as ContractStatus, startDate: new Date("2024-02-01"), endDate: new Date("2026-01-31") },

  // BENA
  { licitacionNo: "LIC-CCSS-004-2023", company: "BENA" as CompanyName, client: "CCSS - Área Salud Coronado", clientType: "PUBLIC" as ClientType, officersCount: 20, positionsCount: 10, monthlyBilling: 8000000, suppliesBudgetPct: 0.08, status: "ACTIVE" as ContractStatus, startDate: new Date("2023-08-01"), endDate: new Date("2026-07-31") },
  { licitacionNo: "LIC-PRIV-005-2024", company: "BENA" as CompanyName, client: "Hipermás Cartago", clientType: "PRIVATE" as ClientType, officersCount: 10, positionsCount: 5, monthlyBilling: 4000000, suppliesBudgetPct: 0.06, status: "ACTIVE" as ContractStatus, startDate: new Date("2024-01-01"), endDate: new Date("2024-12-31") },

  // JOBEN
  { licitacionNo: "LIC-ICE-003-2024", company: "JOBEN" as CompanyName, client: "ICE - Proyecto Reventazón", clientType: "PUBLIC" as ClientType, officersCount: 32, positionsCount: 16, monthlyBilling: 12800000, suppliesBudgetPct: 0.10, status: "ACTIVE" as ContractStatus, startDate: new Date("2024-04-01"), endDate: new Date("2027-03-31") },
  { licitacionNo: "LIC-INA-003-2023", company: "JOBEN" as CompanyName, client: "INA - Sede San José", clientType: "PUBLIC" as ClientType, officersCount: 25, positionsCount: 12, monthlyBilling: 9600000, suppliesBudgetPct: 0.08, status: "ACTIVE" as ContractStatus, startDate: new Date("2023-10-01"), endDate: new Date("2026-09-30") },

  // GRUPO
  { licitacionNo: "LIC-CCSS-005-2024", company: "GRUPO" as CompanyName, client: "CCSS - Hospital Calderón Guardia", clientType: "PUBLIC" as ClientType, officersCount: 50, positionsCount: 25, monthlyBilling: 20000000, suppliesBudgetPct: 0.09, status: "ACTIVE" as ContractStatus, startDate: new Date("2024-01-01"), endDate: new Date("2027-12-31") },
  { licitacionNo: "LIC-PJ-003-2023", company: "GRUPO" as CompanyName, client: "Poder Judicial - Tribunales", clientType: "PUBLIC" as ClientType, officersCount: 45, positionsCount: 22, monthlyBilling: 18000000, suppliesBudgetPct: 0.08, status: "ACTIVE" as ContractStatus, startDate: new Date("2023-06-01"), endDate: new Date("2026-05-31") },
  { licitacionNo: "LIC-PRIV-006-2023", company: "GRUPO" as CompanyName, client: "Citi Bank Costa Rica", clientType: "PRIVATE" as ClientType, officersCount: 15, positionsCount: 7, monthlyBilling: 5600000, suppliesBudgetPct: 0.06, status: "ACTIVE" as ContractStatus, startDate: new Date("2023-03-01"), endDate: new Date("2025-02-28") },

  // ACE
  { licitacionNo: "LIC-ACE-001-2023", company: "ACE" as CompanyName, client: "CCSS - Hospital de Niños", clientType: "PUBLIC" as ClientType, officersCount: 30, positionsCount: 15, monthlyBilling: 12000000, suppliesBudgetPct: 0.08, status: "ACTIVE" as ContractStatus, startDate: new Date("2023-09-01"), endDate: new Date("2026-08-31") },
  { licitacionNo: "LIC-ACE-002-2024", company: "ACE" as CompanyName, client: "UCR - CIMPA", clientType: "PUBLIC" as ClientType, officersCount: 12, positionsCount: 6, monthlyBilling: 4800000, suppliesBudgetPct: 0.07, status: "ACTIVE" as ContractStatus, startDate: new Date("2024-02-01"), endDate: new Date("2027-01-31") },
  { licitacionNo: "LIC-ACE-003-2023", company: "ACE" as CompanyName, client: "ICE - Edificio Central", clientType: "PUBLIC" as ClientType, officersCount: 20, positionsCount: 10, monthlyBilling: 8000000, suppliesBudgetPct: 0.09, status: "ACTIVE" as ContractStatus, startDate: new Date("2023-07-01"), endDate: new Date("2026-06-30") },
  { licitacionNo: "LIC-ACE-004-2022", company: "ACE" as CompanyName, client: "INA - Sede Pérez Zeledón", clientType: "PUBLIC" as ClientType, officersCount: 16, positionsCount: 8, monthlyBilling: 6400000, suppliesBudgetPct: 0.08, status: "ACTIVE" as ContractStatus, startDate: new Date("2022-10-01"), endDate: new Date("2025-09-30") },
  { licitacionNo: "LIC-ACE-005-2024", company: "ACE" as CompanyName, client: "Municipalidad de Desamparados", clientType: "PUBLIC" as ClientType, officersCount: 14, positionsCount: 7, monthlyBilling: 5600000, suppliesBudgetPct: 0.07, status: "ACTIVE" as ContractStatus, startDate: new Date("2024-05-01"), endDate: new Date("2027-04-30") },
  // Expired contract (for testing filters)
  { licitacionNo: "LIC-ACE-000-2021", company: "ACE" as CompanyName, client: "MOPT - Sede Central", clientType: "PUBLIC" as ClientType, officersCount: 10, positionsCount: 5, monthlyBilling: 4000000, suppliesBudgetPct: 0.07, status: "FINISHED" as ContractStatus, startDate: new Date("2021-01-01"), endDate: new Date("2023-12-31") },
];

async function main() {
  console.log("🌱 Seeding database...");

  // Create admin user
  const passwordHash = await bcrypt.hash("admin123", 12);
  const adminUser = await prisma.user.upsert({
    where: { email: "admin@seguridadgrupocr.com" },
    update: {},
    create: {
      name: "Administrador Sistema",
      email: "admin@seguridadgrupocr.com",
      passwordHash,
      role: UserRole.ADMIN,
      isActive: true,
    },
  });
  console.log(`✅ Admin user: ${adminUser.email}`);

  // Create supervisor user
  const supervisorHash = await bcrypt.hash("supervisor123", 12);
  const supervisorUser = await prisma.user.upsert({
    where: { email: "supervisor@seguridadgrupocr.com" },
    update: {},
    create: {
      name: "Supervisor Contratos",
      email: "supervisor@seguridadgrupocr.com",
      passwordHash: supervisorHash,
      role: UserRole.SUPERVISOR,
      isActive: true,
    },
  });
  console.log(`✅ Supervisor user: ${supervisorUser.email}`);

  // Compras (antes contabilidad)
  const comprasHash = await bcrypt.hash("compras123", 12);
  await prisma.user.upsert({
    where: { email: "compras@seguridadgrupocr.com" },
    update: { role: UserRole.COMPRAS },
    create: {
      name: "Compras",
      email: "compras@seguridadgrupocr.com",
      passwordHash: comprasHash,
      role: UserRole.COMPRAS,
      isActive: true,
    },
  });
  console.log(`✅ Compras user: compras@seguridadgrupocr.com`);

  const commercialHash = await bcrypt.hash("comercial123", 12);
  await prisma.user.upsert({
    where: { email: "comercial@seguridadgrupocr.com" },
    update: {},
    create: {
      name: "Comercial",
      email: "comercial@seguridadgrupocr.com",
      passwordHash: commercialHash,
      role: UserRole.COMMERCIAL,
      isActive: true,
    },
  });
  console.log(`✅ Comercial user: comercial@seguridadgrupocr.com`);

  // Create contracts
  console.log("\n📋 Creating contracts...");
  for (const c of SAMPLE_CONTRACTS) {
    await prisma.contract.upsert({
      where: { licitacionNo: c.licitacionNo },
      update: {},
      create: {
        ...c,
        monthlyBilling: c.monthlyBilling,
        suppliesBudgetPct: c.suppliesBudgetPct,
        suppliesPct: c.suppliesBudgetPct,
        createdById: adminUser.id,
      },
    });
  }
  console.log(`✅ ${SAMPLE_CONTRACTS.length} contracts created`);

  // Compute equivalencePct per company
  console.log("\n📊 Computing equivalence percentages...");
  for (const company of COMPANIES) {
    const contracts = await prisma.contract.findMany({
      where: { company, status: { not: "FINISHED" }, deletedAt: null },
    });
    const totalPositions = contracts.reduce((sum: number, c) => sum + c.positionsCount, 0);
    if (totalPositions === 0) continue;

    for (const contract of contracts) {
      await prisma.contract.update({
        where: { id: contract.id },
        data: { equivalencePct: totalPositions > 0 ? contract.positionsCount / totalPositions : 0 },
      });
    }
    console.log(`  ${company}: ${contracts.length} contracts, ${totalPositions} total positions`);
  }

  // Seed sample expenses for the first few contracts
  console.log("\n💰 Seeding sample expenses...");
  const allContracts = await prisma.contract.findMany({ where: { status: "ACTIVE" }, take: 6 });
  const periodMonth = new Date("2024-10-01");

  for (const contract of allContracts) {
    // Uniform expense
    await prisma.uniformExpense.upsert({
      where: { contractId_periodMonth: { contractId: contract.id, periodMonth } },
      update: {},
      create: {
        contractId: contract.id,
        periodMonth,
        shirtQty: Math.floor(contract.officersCount * 0.3),
        shirtCost: 8500,
        pantsQty: Math.floor(contract.officersCount * 0.2),
        pantsCost: 12000,
        shoesQty: Math.floor(contract.officersCount * 0.1),
        shoesCost: 28000,
        capQty: Math.floor(contract.officersCount * 0.4),
        capCost: 3500,
        vestQty: Math.floor(contract.officersCount * 0.15),
        vestCost: 15000,
        totalCost:
          Math.floor(contract.officersCount * 0.3) * 8500 +
          Math.floor(contract.officersCount * 0.2) * 12000 +
          Math.floor(contract.officersCount * 0.1) * 28000 +
          Math.floor(contract.officersCount * 0.4) * 3500 +
          Math.floor(contract.officersCount * 0.15) * 15000,
        createdById: adminUser.id,
      },
    });

    // Audit finding
    await prisma.auditFinding.create({
      data: {
        contractId: contract.id,
        postName: "Puesto Principal",
        findingDate: new Date("2024-10-15"),
        radioQty: 1,
        radioCost: 45000,
        handcuffsQty: 2,
        handcuffsCost: 12000,
        totalCost: 69000,
        status: "PENDING",
        createdById: adminUser.id,
      },
    });
  }

  // Seed a deferred expense
  const deferredExpense = await prisma.deferredExpense.create({
    data: {
      company: "CONSORCIO",
      description: "Mantenimiento flota vehículos Q3 2024",
      category: "TRANSPORT",
      totalAmount: 2500000,
      periodMonth: new Date("2024-10-01"),
      createdById: adminUser.id,
    },
  });

  // Distribute it to CONSORCIO contracts
  const consortioContracts = await prisma.contract.findMany({
    where: { company: "CONSORCIO", status: "ACTIVE", deletedAt: null },
  });
  const totalPositions = consortioContracts.reduce((s: number, c) => s + c.positionsCount, 0);
  for (const contract of consortioContracts) {
    const eqPct = totalPositions > 0 ? contract.positionsCount / totalPositions : 0;
    await prisma.deferredDistribution.create({
      data: {
        deferredExpenseId: deferredExpense.id,
        contractId: contract.id,
        equivalencePct: eqPct,
        allocatedAmount: parseFloat((2500000 * eqPct).toFixed(2)),
      },
    });
  }
  await prisma.deferredExpense.update({
    where: { id: deferredExpense.id },
    data: { isDistributed: true },
  });
  console.log(`✅ Sample deferred expense distributed`);

  console.log("\n✨ Seed complete!");
  console.log("\nCredenciales por defecto (solo existen tras ejecutar el seed):");
  console.log("  Administrador: admin@seguridadgrupocr.com / admin123");
  console.log("  Supervisor:    supervisor@seguridadgrupocr.com / supervisor123");
  console.log("  Compras:       compras@seguridadgrupocr.com / compras123");
  console.log("  Comercial:     comercial@seguridadgrupocr.com / comercial123");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
