/**
 * Daily feed-snapshot refresh at 00:20 UTC (offset from the Discover
 * schedule at 00:10 so the two background passes don't overlap). The
 * /api/feed/snapshot route also lazily triggers on a stale read.
 */
export default async function handler(): Promise<Response> {
  const base = process.env.URL
  if (!base) return new Response('no site url', { status: 500 })
  const res = await fetch(
    `${base}/.netlify/functions/feed-snapshot-background`,
    { method: 'POST' },
  )
  return new Response(`triggered: ${res.status}`)
}

export const config = {
  schedule: '20 0 * * *',
}
