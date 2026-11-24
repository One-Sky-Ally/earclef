import { NextResponse } from 'next/server'
import { isOwner, unauthorized } from '@/lib/curation/auth'
import { ownerLibrary } from '@/lib/discover/library'
import roster from '@/lib/discover/roster.json'
import { sanitizeSong, sanitizeStockPick } from '@/lib/discover/serve'
import {
  appendOwner,
  appendShared,
  replacePickSongs,
  setsToAdd,
  songKey,
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
    // ?songs=1 — every stocked pick's song, for the song re-check (Nov 24, 2026).
    ...(new URL(request.url).searchParams.get('songs') === '1'
      ? {
          songs: picks.map((pick) => ({
            name: pick.name,
            mbid: pick.mbid,
            knownFor: pick.knownFor,
            song: pick.song,
          })),
        }
      : {}),
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

interface ReplaceSongsBody {
  action: 'replace-songs'
  /** [{ mbid, videoId: the stocked song's id, song: the re-verified song, or null to take it away }] */
  replacements?: unknown
}

/** At most this many songs replaced per call. */
const MAX_REPLACEMENTS = 300
const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * The whole list, or null when any entry is malformed — a bad song is
 * never stored, and never silently turned into a removal: only an
 * explicit `song: null` takes a song away.
 */
function replacementMap(raw: unknown): Map<string, DiscoverPick['song']> | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_REPLACEMENTS) return null
  const entries = raw.flatMap((entry): [string, DiscoverPick['song']][] => {
    if (!entry || typeof entry !== 'object') return []
    const { mbid, videoId, song } = entry as { mbid?: unknown; videoId?: unknown; song?: unknown }
    if (typeof mbid !== 'string' || !MBID.test(mbid)) return []
    if (typeof videoId !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) return []
    if (song === null) return [[songKey(mbid, videoId), null]]
    const clean = sanitizeSong(song)
    return clean ? [[songKey(mbid, videoId), clean]] : []
  })
  return entries.length === raw.length ? new Map(entries) : null
}

export async function POST(request: Request) {
  if (!isOwner(request)) return unauthorized()
  let body: AppendBody | DropSongsBody | ReplaceSongsBody
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

  if (body.action === 'replace-songs') {
    const replacements = replacementMap(body.replacements)
    if (!replacements) return noStore({ error: `1–${MAX_REPLACEMENTS} replacements, each { mbid, videoId, song } with a valid song or null` }, 400)
    const [shared, owner] = await Promise.all([readIndex('shared'), readIndex('owner')])
    const sets = await readSets(referencedIds(shared, owner))
    let replaced = 0
    let dropped = 0
    for (const set of sets) {
      const result = replacePickSongs(set.picks, replacements)
      if (result.replaced + result.dropped === 0) continue
      replaced += result.replaced
      dropped += result.dropped
      await writeSet({ ...set, picks: result.picks })
    }
    return noStore({ ok: true, replaced, dropped })
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
