import { isOwner, unauthorized } from '@/lib/curation/auth'
import { dailyCounts, searchesToday } from '@/lib/play/queue/searchBudget'

/**
 * The search budget's books, for the owner (x-owner-key): YouTube
 * searches per Pacific day, split into live visitors, the overnight
 * job and refusals. A refusal means the day's cap of 100 was reached.
 * This answers "how often do we hit the cap" without the Google Cloud
 * console.
 */
export async function GET(request: Request): Promise<Response> {
  if (!isOwner(request)) return unauthorized()
  try {
    const [today, days] = await Promise.all([searchesToday(), dailyCounts()])
    const capped = days.filter((day) => day.refused > 0).length
    return Response.json({ cap: 100, today, days, daysCapReached: capped })
  } catch (error) {
    console.error('search-count read failed:', error)
    return Response.json({ error: 'Could not read the search log' }, { status: 500 })
  }
}
