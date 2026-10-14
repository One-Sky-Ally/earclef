/**
 * Daily trigger for the SHARED Discover pool (the one every visitor
 * sees), the only thing that generates it — page loads never do. Runs
 * at 00:10 UTC; the offset avoids the midnight thundering herd on
 * shared infrastructure. The owner's own pool follows at 00:40
 * (discover-owner-schedule).
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
