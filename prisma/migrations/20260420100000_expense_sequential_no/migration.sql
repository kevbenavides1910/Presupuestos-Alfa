-- Consecutivo autoincremental único para Expense (sequentialNo)
-- Crea la secuencia, agrega la columna, rellena valores existentes en orden cronológico
-- y finalmente engancha la secuencia como default + unique constraint.

CREATE SEQUENCE IF NOT EXISTS "expenses_sequentialNo_seq";

ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "sequentialNo" INTEGER;

-- Asigna números consecutivos a los gastos existentes según su fecha de creación (id como desempate).
WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY "createdAt" ASC, id ASC) AS rn
  FROM "expenses"
  WHERE "sequentialNo" IS NULL
)
UPDATE "expenses" e
SET "sequentialNo" = ordered.rn
FROM ordered
WHERE e.id = ordered.id;

-- Adelanta la secuencia al próximo valor tras el máximo existente
SELECT setval(
  '"expenses_sequentialNo_seq"',
  COALESCE((SELECT MAX("sequentialNo") FROM "expenses"), 0) + 1,
  false
);

-- Default ligado a la secuencia para nuevos registros
ALTER TABLE "expenses"
  ALTER COLUMN "sequentialNo" SET DEFAULT nextval('"expenses_sequentialNo_seq"');

ALTER TABLE "expenses"
  ALTER COLUMN "sequentialNo" SET NOT NULL;

-- Ownership de la secuencia para que se borre con la tabla si aplica
ALTER SEQUENCE "expenses_sequentialNo_seq" OWNED BY "expenses"."sequentialNo";

-- Constraint única
CREATE UNIQUE INDEX IF NOT EXISTS "expenses_sequentialNo_key" ON "expenses"("sequentialNo");
