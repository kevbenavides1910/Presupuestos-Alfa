import path from "path";

export const EXPENSE_UPLOAD_ROOT = process.env.EXPENSE_UPLOAD_DIR
  ? path.resolve(process.env.EXPENSE_UPLOAD_DIR)
  : path.join(process.cwd(), "uploads", "expenses");

export function expenseAttachmentDir(expenseId: string) {
  return path.join(EXPENSE_UPLOAD_ROOT, expenseId);
}

/** Relative to EXPENSE_UPLOAD_ROOT (e.g. `<expenseId>/<file>`) */
export function storagePathForFile(expenseId: string, storedFileName: string) {
  return path.join(expenseId, storedFileName);
}

export const ALLOWED_EXPENSE_ATTACHMENT_MIMES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
]);

export const MAX_EXPENSE_ATTACHMENT_BYTES = 15 * 1024 * 1024;
