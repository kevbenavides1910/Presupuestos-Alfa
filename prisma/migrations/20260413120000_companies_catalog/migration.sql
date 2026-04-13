-- Catálogo de empresas: tabla `companies` y migración de enum CompanyName a TEXT + FK

CREATE TABLE "companies" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("code")
);

INSERT INTO "companies" ("code", "name", "isActive", "sortOrder", "createdAt", "updatedAt") VALUES
('CONSORCIO', 'Consorcio', true, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('MONITOREO', 'Monitoreo', true, 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('TANGO', 'Tango', true, 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('ALFA', 'Alfa', true, 4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('ALFATRONIC', 'Alfatronic', true, 5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('BENLO', 'Benlo', true, 6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('BENA', 'Bena', true, 7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('JOBEN', 'Joben', true, 8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('GRUPO', 'Grupo', true, 9, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('ACE', 'ACE', true, 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

ALTER TABLE "contracts" ALTER COLUMN "company" TYPE TEXT USING ("company"::text);
ALTER TABLE "users" ALTER COLUMN "company" TYPE TEXT USING ("company"::text);
ALTER TABLE "deferred_expenses" ALTER COLUMN "company" TYPE TEXT USING ("company"::text);
ALTER TABLE "admin_expenses" ALTER COLUMN "company" TYPE TEXT USING ("company"::text);
ALTER TABLE "expenses" ALTER COLUMN "company" TYPE TEXT USING ("company"::text);

DROP TYPE IF EXISTS "CompanyName";

ALTER TABLE "contracts" ADD CONSTRAINT "contracts_company_fkey" FOREIGN KEY ("company") REFERENCES "companies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "users" ADD CONSTRAINT "users_company_fkey" FOREIGN KEY ("company") REFERENCES "companies"("code") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "deferred_expenses" ADD CONSTRAINT "deferred_expenses_company_fkey" FOREIGN KEY ("company") REFERENCES "companies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "admin_expenses" ADD CONSTRAINT "admin_expenses_company_fkey" FOREIGN KEY ("company") REFERENCES "companies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_company_fkey" FOREIGN KEY ("company") REFERENCES "companies"("code") ON DELETE SET NULL ON UPDATE CASCADE;
