import { format, formatDistance, isAfter, addDays } from "date-fns";
import { es } from "date-fns/locale";

export function formatCurrency(amount: number | string | null | undefined): string {
  const num = typeof amount === "string" ? parseFloat(amount) : (amount ?? 0);
  return new Intl.NumberFormat("es-CR", {
    style: "currency",
    currency: "CRC",
    maximumFractionDigits: 0,
  }).format(num);
}

export function formatPct(value: number | string | null | undefined): string {
  const num = typeof value === "string" ? parseFloat(value) : (value ?? 0);
  return `${(num * 100).toFixed(2)}%`;
}

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  return format(new Date(date), "dd/MM/yyyy", { locale: es });
}

export function formatMonthYear(date: Date | string | null | undefined): string {
  if (!date) return "—";
  return format(new Date(date), "MMMM yyyy", { locale: es });
}

export function formatRelative(date: Date | string | null | undefined): string {
  if (!date) return "—";
  return formatDistance(new Date(date), new Date(), { locale: es, addSuffix: true });
}

export function daysUntilExpiry(endDate: Date | string): number {
  const end = new Date(endDate);
  const now = new Date();
  const diff = end.getTime() - now.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

export function expiryAlertLevel(endDate: Date | string): "none" | "warning90" | "warning60" | "warning30" | "expired" {
  const days = daysUntilExpiry(endDate);
  if (days < 0) return "expired";
  if (days <= 30) return "warning30";
  if (days <= 60) return "warning60";
  if (days <= 90) return "warning90";
  return "none";
}

export function getFirstDayOfMonth(date: Date = new Date()): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function toMonthString(date: Date): string {
  return format(date, "yyyy-MM");
}

export function fromMonthString(monthStr: string): Date {
  const [year, month] = monthStr.split("-").map(Number);
  return new Date(year, month - 1, 1);
}
