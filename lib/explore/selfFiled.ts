import filed from './self-filed.json'

/**
 * Self-filed artists — the cap bypass behind /get-on-the-map.
 *
 * Fifty countries hold more artists than the 2,000-row cap stores, and
 * a freshly added artist carries no tag votes, so in those countries
 * they would be searchable but never listed. The owner's ruling: the
 * artist's claim wins. An artist who filed themselves in MusicBrainz
 * AND proved control of a page that is theirs is guaranteed a place in
 * their country's (and region's) pool.
 *
 * This is the one list on the site that is a PROMISE rather than a
 * reading of MusicBrainz, so every entry carries its own evidence: the
 * page, the token that was posted on it, and the date it was seen
 * (standing lesson 1 — no halo from the MusicBrainz record). An entry
 * whose evidence is incomplete is never served (standing lesson 5 —
 * missing is not a match). scripts/self-filed.mjs mints, verifies and
 * refreshes entries; this module only reads.
 *
 * Guaranteed a place, not a rank: pinned artists sit at the END of the
 * pool. The top-12 stays weight-ranked like everyone else's.
 */

export interface SelfFiledEvidence {
  /** The page the artist proved control of by posting the token on it. */
  url: string
  token: string
  /** When the token was seen on that page. Null = unverified = unserved. */
  verifiedAt: string | null
}

export interface SelfFiledArtist {
  mbid: string
  name: string
  /** ISO 3166-1 alpha-2, from the MusicBrainz record's own country. */
  country: string
  /** ISO 3166-2 region when the area walk landed on one (US-NV, GB-SCT). */
  region: string | null
  /** Career-start year (persons: birth +15, precompute parity). */
  cs: number | null
  end: number | null
  tags: string[]
  filedAt: string
  evidence: SelfFiledEvidence
}

/** The stored-artist shape the country and state serving layers rank. */
export interface PinnedArtist {
  id: string
  name: string
  cs: number | null
  end: number | null
  w: number
  t: string[]
}

const DATASET = filed as unknown as {
  generatedAt: string | null
  artists: SelfFiledArtist[]
}

/** All three evidence fields present — an absent value never verifies. */
function isVerified(artist: SelfFiledArtist): boolean {
  const evidence = artist.evidence
  return Boolean(
    evidence &&
      typeof evidence.url === 'string' &&
      evidence.url.length > 0 &&
      typeof evidence.token === 'string' &&
      evidence.token.length > 0 &&
      typeof evidence.verifiedAt === 'string' &&
      evidence.verifiedAt.length > 0,
  )
}

function toPinned(artist: SelfFiledArtist): PinnedArtist {
  return {
    id: artist.mbid,
    name: artist.name,
    cs: artist.cs,
    end: artist.end,
    w: 0,
    t: artist.tags ?? [],
  }
}

const byPlace: ReadonlyMap<string, PinnedArtist[]> = (DATASET.artists ?? [])
  .filter(isVerified)
  .reduce((map, artist) => {
    const pinned = toPinned(artist)
    const places = [artist.country, artist.region].filter(
      (place): place is string => Boolean(place),
    )
    return places.reduce(
      (acc, place) =>
        new Map(acc).set(place, [...(acc.get(place) ?? []), pinned]),
      map,
    )
  }, new Map<string, PinnedArtist[]>())

/** Verified self-filed artists for a country or region code. */
export function selfFiledFor(place: string): PinnedArtist[] {
  return byPlace.get(place) ?? []
}

/**
 * Guarantee every pinned artist a slot in the pool without ranking
 * them above anyone: the ordered list keeps its order and loses only
 * as many tail rows as pinned artists need; pinned rows go last.
 */
export function withPinned<T extends { id: string }>(
  ordered: T[],
  pinned: T[],
  limit: number,
): T[] {
  if (pinned.length === 0) return ordered.slice(0, limit)
  const pinnedIds = new Set(pinned.map((artist) => artist.id))
  const present = new Set(ordered.map((artist) => artist.id))
  const held = [
    ...ordered.filter((artist) => pinnedIds.has(artist.id)),
    ...pinned.filter((artist) => !present.has(artist.id)),
  ]
  const others = ordered.filter((artist) => !pinnedIds.has(artist.id))
  return [...others.slice(0, Math.max(0, limit - held.length)), ...held]
}
