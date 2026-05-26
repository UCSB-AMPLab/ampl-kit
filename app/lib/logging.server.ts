/**
 * Structured error logging
 *
 * This file provides the one helper the whole app uses to record an error.
 * Rather than printing a free-form message, it writes a single JSON line to
 * `console.error` — the error text, a stack trace when one exists, a
 * timestamp, and whatever context the caller passes (which action failed, an
 * optional user id, and any extra fields). Cloudflare Workers captures those
 * lines, and the JSON shape makes them searchable and filterable in log
 * aggregation rather than buried in prose.
 *
 * @version v0.1.0
 */
export function logError(
  error: unknown,
  context: {
    action: string;
    userId?: string;
    [key: string]: unknown;
  }
) {
  console.error(
    JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      timestamp: new Date().toISOString(),
      ...context,
    })
  );
}
