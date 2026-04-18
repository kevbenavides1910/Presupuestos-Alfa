-- Flujo de aprobación de gastos, adjuntos y registros CXP/TR

CREATE TYPE "ExpenseApprovalStatus" AS ENUM ('PENDING_APPROVAL', 'PARTIALLY_APPROVED', 'APPROVED', 'REJECTED');

CREATE TYPE "ExpenseApprovalDecision" AS ENUM ('APPROVED', 'REJECTED');

ALTER TABLE "expenses" ADD COLUMN "approvalStatus" "ExpenseApprovalStatus" NOT NULL DEFAULT 'APPROVED';
ALTER TABLE "expenses" ADD COLUMN "currentApprovalStep" INTEGER;
ALTER TABLE "expenses" ADD COLUMN "requiredApprovalSteps" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "expenses" ADD COLUMN "registroCxp" TEXT;
ALTER TABLE "expenses" ADD COLUMN "registroTr" TEXT;

CREATE TABLE "expense_type_approval_steps" (
    "id" TEXT NOT NULL,
    "expenseType" "ExpenseType" NOT NULL,
    "stepOrder" INTEGER NOT NULL,
    "approverUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expense_type_approval_steps_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "expense_type_approval_steps_expenseType_stepOrder_key" ON "expense_type_approval_steps"("expenseType", "stepOrder");
CREATE INDEX "expense_type_approval_steps_expenseType_idx" ON "expense_type_approval_steps"("expenseType");
CREATE INDEX "expense_type_approval_steps_approverUserId_idx" ON "expense_type_approval_steps"("approverUserId");

ALTER TABLE "expense_type_approval_steps" ADD CONSTRAINT "expense_type_approval_steps_approverUserId_fkey" FOREIGN KEY ("approverUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "expense_approvals" (
    "id" TEXT NOT NULL,
    "expenseId" TEXT NOT NULL,
    "stepOrder" INTEGER NOT NULL,
    "approverUserId" TEXT NOT NULL,
    "decision" "ExpenseApprovalDecision" NOT NULL,
    "comment" TEXT,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_approvals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "expense_approvals_expenseId_idx" ON "expense_approvals"("expenseId");
CREATE INDEX "expense_approvals_approverUserId_idx" ON "expense_approvals"("approverUserId");

ALTER TABLE "expense_approvals" ADD CONSTRAINT "expense_approvals_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "expenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "expense_approvals" ADD CONSTRAINT "expense_approvals_approverUserId_fkey" FOREIGN KEY ("approverUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "expense_attachments" (
    "id" TEXT NOT NULL,
    "expenseId" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_attachments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "expense_attachments_expenseId_idx" ON "expense_attachments"("expenseId");
CREATE INDEX "expense_attachments_uploadedById_idx" ON "expense_attachments"("uploadedById");

ALTER TABLE "expense_attachments" ADD CONSTRAINT "expense_attachments_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "expenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "expense_attachments" ADD CONSTRAINT "expense_attachments_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
