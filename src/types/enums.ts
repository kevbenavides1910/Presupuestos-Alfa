// Re-export Prisma enums as TypeScript types for convenience
// These must stay in sync with prisma/schema.prisma

export type {
  CompanyName,
  ClientType,
  ContractStatus,
  UserRole,
  ExpenseCategory,
} from "@prisma/client";
