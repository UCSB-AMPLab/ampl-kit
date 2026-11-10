/**
 * Database error helpers
 *
 * Drizzle wraps a D1 error in its own "Failed query" error, so the SQLite
 * message ("UNIQUE constraint failed: ...") is on `error.cause`, sometimes
 * one level further down. isUniqueViolation walks the whole cause chain.
 *
 * @version v0.4.0
 */

export function isUniqueViolation(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    if (current.message.includes("UNIQUE constraint failed")) return true;
    current = current.cause;
  }
  return false;
}
