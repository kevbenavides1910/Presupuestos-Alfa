-- Añade PLANILLA al enum si falta (Postgres no actualiza enums con prisma db push en algunos despliegues).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typname = 'ExpenseType'
      AND e.enumlabel = 'PLANILLA'
  ) THEN
    ALTER TYPE "ExpenseType" ADD VALUE 'PLANILLA';
  END IF;
END $$;
