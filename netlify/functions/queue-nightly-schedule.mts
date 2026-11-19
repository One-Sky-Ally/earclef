/**
 * Starts the queue's nightly background run (queue-nightly-background):
 * spend the day's leftover YouTube searches, then the 30-day sweep.
 *
 * Two ticks, 05:10 and 06:10 UTC. That is 21:10 and 22:10 Pacific in
 * winter, 22:10 and 23:10 in summer: always before Google's midnight-
 * Pacific reset, so leftovers are still there to spend. The second tick
 * picks up whatever the first left (time ran out, a deploy interrupted
 * it); the background run's lock and its own search count keep the two
 * from double-spending.
 */
const TAG = 'queue-nightly-schedule:'
const BACKGROUND_PATH = '/.netlify/functions/queue-nightly-background'

export default async function handler(): Promise<Response> {
  const base = process.env.URL
  if (!base) {
    const line = `${TAG} NOT triggered: the URL env var is not set for this function`
    console.error(line)
    return new Response(line, { status: 500 })
  }
  let status: number | null = null
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${base}${BACKGROUND_PATH}`, { method: 'POST', signal: AbortSignal.timeout(2000) })
      status = res.status
      if (res.ok) break
    } catch {
      status = null
    }
  }
  const ok = status !== null && status >= 200 && status < 300
  const line = `${TAG} ${ok ? 'triggered' : 'could NOT trigger'} the nightly run (last status ${status ?? 'no response'})`
  if (ok) console.log(line)
  else console.error(line)
  return new Response(line, { status: ok ? 200 : 502 })
}

export const config = {
  schedule: '10 5,6 * * *',
}
