/**
 * Centralised time utilities.
 *
 * All server-side date comparisons must go through this module so that
 * switching the TZ env var (e.g. "America/Costa_Rica") is the single
 * source of truth for "what time is it now".
 *
 * Node.js reads process.env.TZ at startup, so as long as TZ is set in
 * the environment before the process starts, `new Date()` already returns
 * the right instant.  These helpers exist for clarity and to avoid
 * accidental browser-side `new Date()` leaking into server logic.
 */

/** Returns the current date/time in the server's configured timezone. */
export function nowServer(): Date {
  return new Date();
}

/**
 * Returns a Date that is `months` calendar months before now (server time).
 * Used for cutoff calculations like "closed more than 6 months ago".
 */
export function monthsAgoServer(months: number): Date {
  const d = nowServer();
  d.setMonth(d.getMonth() - months);
  return d;
}

/**
 * Returns a Date set to the END of the given day (23:59:59.999) in server TZ.
 * Useful when comparing endDate (stored as midnight UTC) — a contract ending
 * "today" should not be expired until the day is truly over.
 */
export function endOfDayServer(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

/** Current year according to server clock. */
export function currentYearServer(): number {
  return nowServer().getFullYear();
}
