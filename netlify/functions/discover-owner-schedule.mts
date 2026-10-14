/**
 * Daily trigger for the OWNER's own Discover pool, 30 minutes after the
 * shared pool's (00:10 UTC) so the two runs never overlap on the
 * MusicBrainz (1 request/s) and Discogs (25/min) limits.
 */
export default async function handler(): Promise<Response> {
  const base = process.env.URL
  if (!base) return new Response('no site url', { status: 500 })
  const res = await fetch(
    `${base}/.netlify/functions/discover-generate-background?pool=owner`,
    { method: 'POST' },
  )
  return new Response(`triggered: ${res.status}`)
}

export const config = {
  schedule: '40 0 * * *',
}
