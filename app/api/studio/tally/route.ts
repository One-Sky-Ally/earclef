import { NextResponse } from 'next/server'
import { isOwner, unauthorized } from '@/lib/curation/auth'
import { readRecentDays } from '@/lib/tally/store'

/** Owner-only: the last 90 days of anonymous counts, newest first. */
export async function GET(request: Request) {
  if (!isOwner(request)) return unauthorized()
  return NextResponse.json({ days: await readRecentDays(90) })
}
