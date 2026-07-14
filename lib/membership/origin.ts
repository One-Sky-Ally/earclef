/**
 * Absolute origin for links that leave the site (Stripe redirects, magic
 * links in email). Netlify sets URL in production; the request URL covers
 * local dev.
 */
export function siteOrigin(request: Request): string {
  return process.env.URL ?? new URL(request.url).origin
}
