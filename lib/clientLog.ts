/**
 * Lightweight client-side error reporting: logs locally with detail and
 * fire-and-forgets a beacon to /api/client-log so failures on OTHER
 * people's machines land in the Netlify function logs with a reason —
 * "the globe failed on the demo laptop" should never be a mystery again.
 */
export function reportClientError(
  context: string,
  reason: string,
  detail?: unknown,
): void {
  console.error(`[earclef] ${context}: ${reason}`, detail ?? '')
  try {
    const body = JSON.stringify({
      context: context.slice(0, 60),
      reason: reason.slice(0, 200),
      detail: String(detail ?? '').slice(0, 500),
      ua: navigator.userAgent.slice(0, 200),
    })
    // /api/postcard — an innocuous path by design; "log"/"track"-shaped
    // paths get eaten by content blockers, taking the evidence with them.
    void fetch('/api/postcard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {})
  } catch {
    // Reporting must never throw.
  }
}
