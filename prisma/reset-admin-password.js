/**
 * Restablece contraseñas de demo en producción (mismas que seed).
 * En el VPS: docker exec security_contracts_app node prisma/reset-admin-password.js
 */
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

async function main() {
  const prisma = new PrismaClient();
  const adminHash = await bcrypt.hash("admin123", 12);
  const supervisorHash = await bcrypt.hash("supervisor123", 12);

  const admin = await prisma.user.findUnique({
    where: { email: "admin@seguridadgrupocr.com" },
  });
  if (!admin) {
    throw new Error('No existe admin@seguridadgrupocr.com. Ejecuta: npx prisma db seed');
  }
  await prisma.user.update({
    where: { email: "admin@seguridadgrupocr.com" },
    data: { passwordHash: adminHash, isActive: true, updatedAt: new Date() },
  });

  const sup = await prisma.user.findUnique({
    where: { email: "supervisor@seguridadgrupocr.com" },
  });
  if (sup) {
    await prisma.user.update({
      where: { email: "supervisor@seguridadgrupocr.com" },
      data: { passwordHash: supervisorHash, isActive: true, updatedAt: new Date() },
    });
    console.log("OK: supervisor@seguridadgrupocr.com / supervisor123");
  }

  console.log("OK: admin@seguridadgrupocr.com / admin123");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
