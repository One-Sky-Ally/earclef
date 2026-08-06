/**
 * Legacy alias: already-deployed clients still beacon here. The real
 * handler lives at /api/postcard — that name doesn't pattern-match
 * ad-block lists the way "client-log" does.
 */
export { POST } from '../postcard/route'
