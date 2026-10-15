import { NextResponse } from 'next/server'
import { isOwner, unauthorized } from '@/lib/curation/auth'
import { ownerLibrary } from '@/lib/discover/library'
import roster from '@/lib/discover/roster.json'
import { sanitizeStockPick } from '@/lib/discover/serve'
import {
  appendOwner,
  appendShared,
  setsToAdd,
  sharedReady,
  sharedSetFor,
  sharedThrough,
  type OwnerIndex,
  type SharedIndex,
} from '@/lib/discover/stock'
import {
  deleteSets,
  newSetId,
  readIndex,
  readSets,
  writeIndex,
  writeSet,
} from '@/lib/discover/stockStore'
import { SET_SIZES, type DiscoverPick, type StockKind } from '@/lib/discover/types'

/**
 * The Discover stock, for the /refresh-earclef session only (owner key).
 * GET: how much of each list is ready, what the next refresh should add,
 * every artist already stocked (so nothing repeats), every stocked
 * video (for the playability re-check) and the owner's rows (the taste
 * the owner's sets are written from). POST: `append` full sets the
 * local script verified, or `drop-songs` for videos that died.
 * Nothing here calls a model.
 */

const ROSTER_SLUGS = new Set(roster.map((artist) => artist.slug))
const MAX_SETS_PER_UPLOAD = 10

function noStore(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

const today = () => new Date().toISOString().slice(0, 10)

/** Every set either list still refers to. */
function referencedIds(shared: SharedIndex | null, owner: OwnerIndex | null): string[] {
  return [
    ...new Set([
      ...(shared?.days.map((day) => day.id) ?? []),
      ...(owner?.queue ?? []),
      ...(owner?.current ? [owner.current.id] : []),
      ...(owner?.seen.map((entry) => entry.id) ?? []),
    ]),
  ]
}

export async function GET(request: Request) {
  if (!isOwner(request)) return unauthorized()
  const date = today()
  const [shared, owner, rows] = await Promise.all([
    readIndex('shared'),
    readIndex('owner'),
    ownerLibrary(),
  ])
  const sets = await readSets(referencedIds(shared, owner))
  const picks = sets.flatMap((set) => set.picks)
  const sharedNow = sharedReady(shared, date)
  const ownerNow = owner?.queue.length ?? 0
  return noStore({
    today: date,
    setSizes: SET_SIZES,
    shared: {
      ready: sharedNow,
      through: sharedThrough(shared),
      todayArchive: sharedSetFor(shared, date)?.archive ?? null,
      add: setsToAdd('shared', sharedNow),
    },
    owner: { ready: ownerNow, seen: owner?.seen.length ?? 0, add: setsToAdd('owner', ownerNow) },
    stocked: {
      names: [...new Set(picks.map((pick) => pick.name))],
      mbids: [...new Set(picks.map((pick) => pick.mbid))],
    },
    videos: [...new Set(picks.flatMap((pick) => (pick.song ? [pick.song.videoId] : [])))],
    ownerLibrary: rows.library,
    ownerLibrarySource: rows.source,
  })
}

interface AppendBody {
  action: 'append'
  kind?: string
  sets?: unknown
}

interface DropSongsBody {
  action: 'drop-songs'
  videoIds?: unknown
}

export async function POST(request: Request) {
  if (!isOwner(request)) return unauthorized()
  let body: AppendBody | DropSongsBody
  try {
    body = await request.json()
  } catch {
    return noStore({ error: 'Invalid JSON body' }, 400)
  }
  const date = today()

  if (body.action === 'drop-songs') {
    const dead = new Set(
      Array.isArray(body.videoIds)
        ? body.videoIds.filter((id): id is string => typeof id === 'string')
        : [],
    )
    const [shared, owner] = await Promise.all([readIndex('shared'), readIndex('owner')])
    const sets = await readSets(referencedIds(shared, owner))
    let songsDropped = 0
    for (const set of sets) {
      let changed = false
      const picks = set.picks.map((pick): DiscoverPick => {
        if (!pick.song || !dead.has(pick.song.videoId)) return pick
        changed = true
        songsDropped++
        // The pick stays — its play/read link still works; only the song goes.
        return { ...pick, song: null }
      })
      if (changed) await writeSet({ ...set, picks })
    }
    return noStore({ ok: true, songsDropped })
  }

  if (body.action !== 'append') return noStore({ error: 'Unknown action' }, 400)
  const kind = body.kind as StockKind
  if (kind !== 'shared' && kind !== 'owner') return noStore({ error: 'Unknown list' }, 400)
  if (!Array.isArray(body.sets) || body.sets.length === 0) {
    return noStore({ error: 'No sets' }, 400)
  }
  if (body.sets.length > MAX_SETS_PER_UPLOAD) {
    return noStore({ error: `At most ${MAX_SETS_PER_UPLOAD} sets per upload` }, 400)
  }

  const [shared, owner] = await Promise.all([readIndex('shared'), readIndex('owner')])
  const stocked = new Set(
    (await readSets(referencedIds(shared, owner))).flatMap((set) => set.picks.map((p) => p.mbid)),
  )
  const accepted: { id: string; picks: DiscoverPick[] }[] = []
  const rejected: number[] = []
  body.sets.forEach((rawSet, position) => {
    const picks = (Array.isArray(rawSet) ? rawSet : [])
      .map((raw) => sanitizeStockPick(raw, ROSTER_SLUGS))
      .filter((pick): pick is DiscoverPick => pick !== null && !stocked.has(pick.mbid))
    const unique = picks.filter(
      (pick, i) => picks.findIndex((other) => other.mbid === pick.mbid) === i,
    )
    // Full sets only: a short one goes back to the script for next time.
    if (unique.length !== SET_SIZES[kind]) {
      rejected.push(position)
      return
    }
    for (const pick of unique) stocked.add(pick.mbid)
    accepted.push({ id: newSetId(kind, date), picks: unique })
  })

  const createdAt = new Date().toISOString()
  for (const set of accepted) await writeSet({ ...set, kind, createdAt })
  const ids = accepted.map((set) => set.id)
  if (kind === 'shared') {
    const { index, dropped } = appendShared(shared, ids, date)
    await writeIndex('shared', index)
    if (dropped.length > 0) await deleteSets(dropped)
    return noStore({ ok: true, added: ids.length, rejected, ready: sharedReady(index, date) })
  }
  const { index, refused } = appendOwner(owner, ids)
  await writeIndex('owner', index)
  if (refused.length > 0) await deleteSets(refused)
  return noStore({
    ok: true,
    added: ids.length - refused.length,
    rejected,
    ready: index.queue.length,
  })
}
