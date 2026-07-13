/**
 * Daily trigger so the Discover pool is fresh before the first visitor
 * (the /api/discover route also lazily triggers on a miss — this just
 * makes the rotation punctual). Runs at 00:10 UTC; the offset avoids the
 * midnight thundering herd on shared infrastructure.
 */
export default async function handler(): Promise<Response> {
  const base = process.env.URL
  if (!base) return new Response('no site url', { status: 500 })
  const res = await fetch(
    `${base}/.netlify/functions/discover-generate-background`,
    { method: 'POST' },
  )
  return new Response(`triggered: ${res.status}`)
}

export const config = {
  schedule: '10 0 * * *',
}
