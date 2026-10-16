/**
 * Discover verification: every candidate written during /refresh-earclef
 * is checked before it can reach the page — the artist must exist on
 * MusicBrainz under exactly that name, the knownFor title must be in
 * their real catalogue (else their own top release replaces it), and a
 * playable song is looked for (Discogs record videos and the artist's
 * own channel, under the site's identity bar). Runs LOCALLY in the
 * refresh session (scripts/discover-stock.mjs) — no model call, no
 * server-side job. The site's verified-data bar applies to AI output too.
 */
import {
  bandcampRel,
  fetchMbArtist,
  mbAliasNames,
  resolveMbArtistPlay,
} from '../play/resolve'
import { resolveDiscoverSong } from './song'
import type { DiscoverPick, RawPick } from './types'

const MB_USER_AGENT =
  'EarClefDiscover/0.1 (https://earclef.com; fiohmemorial@gmail.com)'

export function normalize(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\band\b/g, '&')
    .replace(/[^a-z0-9&]+/g, '')
}

/** Only real roster slugs, at most three, in the candidate's order. */
export function rosterLinks(slugs: unknown, rosterSlugs: ReadonlySet<string>): string[] {
  if (!Array.isArray(slugs)) return []
  return [...new Set(slugs.filter((slug): slug is string => typeof slug === 'string'))]
    .filter((slug) => rosterSlugs.has(slug))
    .slice(0, 3)
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

interface MbArtistMatch {
  mbid: string
  canonicalName: string
}

async function verifyOnMusicBrainz(name: string): Promise<MbArtistMatch | null> {
  const query = encodeURIComponent(`artist:"${name.replace(/"/g, '')}"`)
  const url = `https://musicbrainz.org/ws/2/artist?query=${query}&limit=3&fmt=json`
  try {
    const res = await fetch(url, { headers: { 'User-Agent': MB_USER_AGENT } })
    if (!res.ok) return null
    const body = (await res.json()) as {
      artists?: { id: string; name: string; score: number }[]
    }
    const top = body.artists?.[0]
    if (!top || top.score < 85) return null
    if (normalize(top.name) !== normalize(name)) return null
    return { mbid: top.id, canonicalName: top.name }
  } catch {
    return null
  }
}

interface MbReleaseGroup {
  title?: string
  'first-release-date'?: string
  'primary-type'?: string
}

interface VerifiedCatalog {
  knownFor: string
  /** The artist's release-group titles, knownFor first then newest first. */
  titles: string[]
}

/** Catalog titles for the song resolver's channel path, newest first. */
function catalogTitles(groups: MbReleaseGroup[], knownFor: string): string[] {
  const dated = groups
    .filter((group): group is MbReleaseGroup & { title: string } => Boolean(group.title))
    .sort((a, b) =>
      (b['first-release-date'] ?? '').localeCompare(a['first-release-date'] ?? ''),
    )
    .map((group) => group.title)
  const seen = new Set<string>()
  return [knownFor, ...dated].filter((title) => {
    const key = normalize(title)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Verify the model's knownFor title against the artist's real catalog:
 * a normalized match among their release groups, else one recording
 * search. No match → the artist's own top release replaces it (latest
 * dated album, else latest dated anything, else the first group). An
 * artist with no catalog at all returns null and the pick is dropped.
 */
async function verifiedKnownFor(
  mbid: string,
  proposed: string,
): Promise<VerifiedCatalog | null> {
  const rgUrl = `https://musicbrainz.org/ws/2/release-group?artist=${mbid}&limit=100&fmt=json`
  let groups: MbReleaseGroup[] = []
  try {
    const res = await fetch(rgUrl, { headers: { 'User-Agent': MB_USER_AGENT } })
    if (res.ok) {
      const body = (await res.json()) as { 'release-groups'?: MbReleaseGroup[] }
      groups = body['release-groups'] ?? []
    }
  } catch {
    // fall through — treated as an empty catalog below
  }
  await sleep(1100) // MusicBrainz rate limit: 1 req/s

  const proposedKey = normalize(proposed)
  if (
    proposedKey &&
    groups.some((group) => normalize(group.title ?? '') === proposedKey)
  ) {
    return { knownFor: proposed, titles: catalogTitles(groups, proposed) }
  }

  try {
    const query = encodeURIComponent(
      `recording:"${proposed.replace(/"/g, '')}" AND arid:${mbid}`,
    )
    const res = await fetch(
      `https://musicbrainz.org/ws/2/recording?query=${query}&limit=1&fmt=json`,
      { headers: { 'User-Agent': MB_USER_AGENT } },
    )
    if (res.ok) {
      const body = (await res.json()) as { count?: number }
      if ((body.count ?? 0) > 0) {
        await sleep(1100)
        return { knownFor: proposed, titles: catalogTitles(groups, proposed) }
      }
    }
  } catch {
    // fall through to the catalog-sourced replacement
  }
  await sleep(1100)

  const dated = groups
    .filter((group) => group.title && group['first-release-date'])
    .sort((a, b) =>
      (b['first-release-date'] ?? '').localeCompare(
        a['first-release-date'] ?? '',
      ),
    )
  const replacement =
    dated.find((group) => group['primary-type'] === 'Album') ??
    dated[0] ??
    groups.find((group) => group.title)
  return replacement?.title
    ? { knownFor: replacement.title, titles: catalogTitles(groups, replacement.title) }
    : null
}

export interface VerifyContext {
  /** Normalized roster names and slugs: anyone on Ear Clef is never a pick. */
  rosterKeys: ReadonlySet<string>
  rosterSlugs: ReadonlySet<string>
  /** Epoch ms: no song search starts after this. */
  songDeadline: number
  /** Discogs records read at most for the song (the local run reads deeper). */
  maxRecords?: number
  /** Step-by-step notes — `npm run discover-stock -- why "<artist>"`. */
  trace?: (line: string) => void
}

export interface VerifyResult {
  pick: DiscoverPick | null
  /** Why a candidate was left out. */
  reason?: 'on the roster' | 'not on MusicBrainz' | 'no catalogue' | 'no playable song'
}

/**
 * One candidate → a verified pick, or the reason it was left out: not
 * on MusicBrainz under that exact name, on the roster already, no
 * catalogue — or NO PLAYABLE SONG. Discover shows only picks that play
 * here (owner ruling, Oct 15 2026: the Songs-about rule), so a pick
 * without a verified song is never stocked. MusicBrainz is paced at
 * 1 request/s inside; Discogs paces itself.
 */
export async function verifyCandidate(
  candidate: RawPick,
  context: VerifyContext,
): Promise<VerifyResult> {
  const trace = context.trace
  const key = normalize(candidate.name)
  if (!key || context.rosterKeys.has(key)) return { pick: null, reason: 'on the roster' }
  const match = await verifyOnMusicBrainz(candidate.name)
  await sleep(1100) // MusicBrainz rate limit: 1 req/s
  if (!match) {
    trace?.(`musicbrainz: no artist named exactly "${candidate.name}" (score ≥ 85)`)
    return { pick: null, reason: 'not on MusicBrainz' }
  }
  trace?.(`musicbrainz: ${match.canonicalName} (${match.mbid})`)
  if (context.rosterKeys.has(normalize(match.canonicalName))) {
    return { pick: null, reason: 'on the roster' }
  }

  const catalog = await verifiedKnownFor(match.mbid, candidate.knownFor)
  if (!catalog) return { pick: null, reason: 'no catalogue' }
  trace?.(`catalogue: known for "${catalog.knownFor}"; ${catalog.titles.length} release-group titles`)

  // One MB artist call feeds the play chain AND the song resolver.
  const artist = await fetchMbArtist(match.mbid)
  await sleep(1100)
  const { play, read } = await resolveMbArtistPlay(match.mbid, null, artist)
  const song = await resolveDiscoverSong({
    name: match.canonicalName,
    knownFor: catalog.knownFor,
    relations: artist?.relations ?? [],
    aliases: mbAliasNames(artist),
    titles: catalog.titles,
    deadline: context.songDeadline,
    maxRecords: context.maxRecords,
    trace,
  })
  if (!song) return { pick: null, reason: 'no playable song' }
  const pick: DiscoverPick = {
    name: match.canonicalName,
    why: candidate.why,
    knownFor: catalog.knownFor,
    knownForVerified: true,
    mbid: match.mbid,
    play,
    read: read ?? {
      kind: 'musicbrainz',
      url: `https://musicbrainz.org/artist/${match.mbid}`,
    },
    listenHref: play?.url ?? read?.url ?? `https://musicbrainz.org/artist/${match.mbid}`,
    song,
    bandcamp: bandcampRel(artist?.relations),
    connectsTo: rosterLinks(candidate.connectsTo, context.rosterSlugs),
  }
  return { pick }
}
