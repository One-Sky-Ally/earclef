import { NextResponse } from 'next/server'
import { isOwner, unauthorized } from '@/lib/curation/auth'
import { readQueue, writeQueue, type FollowEntry } from '@/lib/curation/followStore'
import { getOwnerAccount } from '@/lib/curation/ownerAccount'
import { artistKey, sanitizePageless } from '@/lib/fans/artistKeys'
import { ensureFollowNumber } from '@/lib/fans/followNumbers'
import { rosterSlugByMbid } from '@/lib/fans/rosterIndex'
import { addPagelessFollows, getFan, setFollow, type PagelessFollow } from '@/lib/fans/store'

/**
 * ONE-TIME MOVE (owner, Nov 28 2026: "Add every artist I've followed
 * from Discover so they show up in my Following like the rest"): the
 * artists in the retired Discover queue (lib/curation/followStore) go
 * into the owner's linked account in On the radar — the row the queue
 * said they start in. An artist with a page by now is followed on the
 * page; the rest by MusicBrainz id. Additive and safe to repeat: an
 * artist already followed keeps the row the owner gave them. Nothing is
 * lost: a queue that cannot be read changes nothing, and any entry that
 * could not be placed (a bad id, the follow limit) stays in the queue
 * and is named in the answer. The body may name one verified video per
 * artist (MusicBrainz id → video id, from their Discover pick).
 */
const TIER = 'on-the-radar' as const

function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: Request) {
  if (!isOwner(request)) return unauthorized()
  const email = await getOwnerAccount()
  if (!email) return json({ error: 'Link your account in the Studio first.' }, 409)

  let videos: Record<string, unknown> = {}
  try {
    const body = (await request.json()) as { videos?: unknown }
    if (body.videos && typeof body.videos === 'object') videos = body.videos as Record<string, unknown>
  } catch {
    // No body: the follows move without pictures.
  }

  try {
    const queue = await readQueue()
    const slugByMbid = rosterSlugByMbid()
    const left: FollowEntry[] = []
    const pageless: { entry: FollowEntry; follow: PagelessFollow }[] = []
    const withPage: { entry: FollowEntry; slug: string }[] = []
    for (const entry of queue) {
      const key = artistKey(entry.mbid ?? '')
      const artist = sanitizePageless({ name: entry.name, videoId: videos[entry.mbid] })
      const slug = key ? slugByMbid[key.slice(3)] : undefined
      if (!key || !artist) left.push(entry)
      else if (slug) withPage.push({ entry, slug })
      else pageless.push({ entry, follow: { key, tier: TIER, ...artist } })
    }

    const moved = await addPagelessFollows(email, pageless.map(({ follow }) => follow))
    const skippedKeys = new Set(moved.skipped.map((follow) => follow.key))
    left.push(...pageless.filter(({ follow }) => skippedKeys.has(follow.key)).map(({ entry }) => entry))

    const added = [...moved.added]
    const kept = [...moved.kept]
    for (const { entry, slug } of withPage) {
      const fan = await getFan(email)
      if (fan?.follows.includes(slug)) {
        kept.push(entry.name)
        continue
      }
      const { follows } = await setFollow(email, slug, true, TIER)
      if (!follows.includes(slug)) {
        left.push(entry)
        continue
      }
      await ensureFollowNumber(slug, email)
      added.push(entry.name)
    }

    await writeQueue(left)
    return json({ ok: true, queued: queue.length, added, kept, left: left.map((entry) => entry.name) })
  } catch (error) {
    console.error('Moving the Discover follows failed:', error)
    return json({ error: 'The move did not finish — the queue still holds every artist not yet moved; try again.' }, 500)
  }
}
