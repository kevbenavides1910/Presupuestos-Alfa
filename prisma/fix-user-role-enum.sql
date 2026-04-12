-- Ejecutar una vez si la base ya tenía CONTABILIDAD (npm run db:fix-user-role-enum).
-- Requiere PostgreSQL 10+ para RENAME VALUE.
ALTER TYPE "UserRole" ADD VALUE 'COMMERCIAL';
ALTER TYPE "UserRole" RENAME VALUE 'CONTABILIDAD' TO 'COMPRAS';
