/**
 * SHARED-CREDIT RULE (owner ruling, Oct 10, 2026): "a shared credit
 * counts only if the artist performed on that track, never on a
 * compilation."
 *
 * A shared anchor is a record crediting the artist BESIDE others with
 * no per-track artists — a band and its singer, a duet, but also a
 * two-sided 78 whose sides belong to different acts. A release-level
 * credit cannot tell those apart, so it is not evidence about any one
 * track. A record passes only when:
 *   1. it is not a compilation (format description "Compilation", or
 *      credited to Various), and
 *   2. the video is tied to a specific track — an exact title variant
 *      (whole units, no fuzzy matching) or, failing that, exactly one
 *      track within ±3 s of the video's length — or it is an upload of
 *      the whole record (the record's own title), and then EVERY track
 *      must pass 3 — and
 *   3. that track carries a PERFORMER credit for the artist:
 *        track-artist             the track's own artists include them
 *        track-performer-role     a performing extra role on the track
 *        release-performer-role   a performing release-level extra role
 *                                 whose track scope covers the track
 *                                 (an empty scope covers the record)
 *        joint-credit             the release credits them JOINTLY
 *                                 ("A & B", "A Et B", "A With B" — the
 *                                 Discogs `join`) and the track names
 *                                 no one else; a split "/", a list ","
 *                                 or "vs" is not evidence
 *        single-track-record      the record has one track, so its
 *                                 credit can only be about that track
 * Writing, producing, arranging and design roles are not performing
 * (isPerformingCredit below — stricter than the arbitration's
 * substring test, which reads "Photography By" as a rap credit).
 *
 * `looseReadingPass` reports the other reading for the owner: release
 * credits inherited by every track (not a compilation, track tied).
 */
import { durationSeconds, isPerformingRole, titleVariants, variantsIntersect } from './extraPlayIdentity.mjs'

/** Discogs "Various" (the dump's own id for it). */
const VARIOUS_ID = 194
const DURATION_TOLERANCE_S = 3

const isTrackRow = (row) => (row.type_ ?? 'track') === 'track'
const idOf = (credit) => Number(credit?.id)
const positionOf = (row) => String(row.position ?? '').trim().toUpperCase()

/**
 * Playable rows in record order. A medley's index row contributes its
 * sub-tracks, each remembering the index row so the medley's own
 * credits and position still apply to it.
 */
function flatTracks(tracklist) {
  return (tracklist ?? []).flatMap((row) => {
    if (isTrackRow(row)) return [row]
    if (row.type_ === 'index') {
      return (row.sub_tracks ?? []).filter(isTrackRow).map((sub) => ({ ...sub, parent: row }))
    }
    return []
  })
}

/**
 * A credit role is PERFORMING when any of its comma-separated parts is.
 * The shared isPerformingRole matches substrings, so "Photography By"
 * (rap), "Arranged By [Horns]" and "Orchestrated By" read as playing;
 * here an "… By" part counts only as Performed/Played/Sung/Conducted/
 * Accompanied By,
 * bracket qualifiers are ignored, and design/engineering words never do.
 */
const PERFORMING_BY = /^(performed|played|sung|conducted|vocals|accompanied) by$/i
/**
 * Performing words the shared English list lacks, each seen on a real
 * held record's credits (Oct 10 re-check): Spanish "Arpa", the
 * harmonium, the Kazakh kobyz, the Persian tar, plain "Musician" and
 * "Ensemble". Whole words only.
 */
const EXTRA_PERFORMING = /\b(arpa|harmonium|kobyz|tar|musician|ensemble)\b/i
const NEVER_PERFORMING = /design|photo|graphic|typograph|artwork|liner|master|mix|engineer|lacquer|layout|art direction/i
export function isPerformingCredit(role) {
  return String(role ?? '').split(',').some((raw) => {
    const part = raw.replace(/\[[^\]]*\]/g, '').trim()
    if (!part || NEVER_PERFORMING.test(part)) return false
    if (/\bby\b|-by$/i.test(part)) return PERFORMING_BY.test(part)
    return isPerformingRole(part) || EXTRA_PERFORMING.test(part)
  })
}

/**
 * Discogs stores, on each release artist, the `join` text to the NEXT
 * credit (forms below are the ones seen on the re-checked records,
 * an article allowed after: "Et L'", "With The"). A conjunction that means "performing together" makes the
 * release credit a joint performer credit; a slash (a split), a comma
 * (a list), "vs" (a remix pairing) or nothing says nothing about who
 * plays which side.
 */
const JOINT_JOIN = /^(&|\+|and|y|e|et|und|i|и|with|con|com|avec|mit|feat\.?|featuring|ft\.?|accompanied by|acc\. by|accompagnée?s? par|led by|canta)(\s*(the|l'|le|la|les|los|las|lo|il|gli|o|os|a|as))?:?$/i
/** Joins that name the accompanying group inside them ("Y Su Conjunto Paraguayo"). */
const JOINT_JOIN_PREFIX = /^(y su|y sus|con su|con la|e seu|e sua|et son|et sa|et ses|with his|with her|and his|and her|und sein|und ihr)\b/i
const isJointJoin = (join) => {
  const text = String(join ?? '').trim()
  return JOINT_JOIN.test(text) || JOINT_JOIN_PREFIX.test(text)
}
const isListComma = (join) => String(join ?? '').trim() === ','

/**
 * Is this artist joined to its neighbours by a performing conjunction?
 * Commas are list punctuation INSIDE a credit: "A, B & C" is one joint
 * list, so the artist's comma-run counts when the join that closes or
 * opens the run is joint. A comma-only list, a slash or "vs" is not.
 */
function jointlyCredited(record, artistId) {
  const artists = record.artists ?? []
  return artists.some((credit, index) => {
    if (idOf(credit) !== artistId) return false
    let first = index
    while (first > 0 && isListComma(artists[first - 1].join)) first--
    let last = index
    while (last < artists.length - 1 && isListComma(artists[last].join)) last++
    const closes = last < artists.length - 1 && isJointJoin(artists[last].join)
    const opens = first > 0 && isJointJoin(artists[first - 1].join)
    return closes || opens
  })
}

export function isCompilation(record) {
  const described = (record.formats ?? []).some((format) =>
    (format.descriptions ?? []).some((text) => /^compilation$/i.test(String(text).trim())))
  return described || (record.artists ?? []).some((artist) => idOf(artist) === VARIOUS_ID)
}

/**
 * Positions covered by a Discogs extra-credit scope ("A1, B2", "A1 & B2",
 * "A1 to B2", "A1-A3", any case), over the record's own track order
 * (medley index positions included, so "A" covers its sub-tracks).
 * Null for an empty scope (the whole record). A position the record
 * lacks matches nothing — a scope never widens by failing to parse.
 */
export function tracksInScope(scope, tracklist) {
  const text = String(scope ?? '').trim()
  if (!text) return null
  const order = (tracklist ?? []).flatMap((row) => {
    if (isTrackRow(row)) return [positionOf(row)]
    if (row.type_ === 'index') return [positionOf(row), ...(row.sub_tracks ?? []).map(positionOf)]
    return []
  }).filter(Boolean)
  const covered = new Set()
  const addRange = (fromRaw, toRaw) => {
    const from = order.indexOf(fromRaw.trim().toUpperCase())
    const to = order.indexOf(toRaw.trim().toUpperCase())
    if (from === -1 || to === -1 || to < from) return
    for (const position of order.slice(from, to + 1)) covered.add(position)
  }
  for (const raw of text.split(/,|&/).map((piece) => piece.trim()).filter(Boolean)) {
    const part = raw.toUpperCase()
    if (order.includes(part)) {
      covered.add(part)
      continue
    }
    const range = /^(.+?)\s+TO\s+(.+)$/.exec(part) ?? /^(.+?)\s*-\s*(.+)$/.exec(part)
    if (range) addRange(range[1], range[2])
  }
  return covered
}

/** The record's tracks the upload is tied to: exact title, else one unique duration. */
function tiedTracks(tracks, uploadTitle, uploadSeconds, aliases) {
  const upload = titleVariants(uploadTitle ?? '', aliases)
  const byTitle = tracks.filter((row) => variantsIntersect(upload, titleVariants(row.title, aliases)))
  if (byTitle.length > 0) return { tracks: byTitle, by: 'title' }
  if (!uploadSeconds) return { tracks: [], by: null }
  const byLength = tracks.filter((row) => {
    const seconds = durationSeconds(row.duration)
    return seconds !== null && Math.abs(seconds - uploadSeconds) <= DURATION_TOLERANCE_S
  })
  return byLength.length === 1 ? { tracks: byLength, by: 'duration' } : { tracks: [], by: null }
}

/** A row's own artists, or its medley's when it names none. */
const rowArtists = (row) => ((row.artists ?? []).length > 0 ? row.artists : row.parent?.artists ?? [])

function performerCredit(row, record, artistId, tracks, releaseCredited) {
  if (rowArtists(row).some((credit) => idOf(credit) === artistId)) return 'track-artist'
  const onTrack = [...(row.extraartists ?? []), ...(row.parent?.extraartists ?? [])]
  if (onTrack.some((credit) => idOf(credit) === artistId && isPerformingCredit(credit.role))) {
    return 'track-performer-role'
  }
  const positions = [positionOf(row), row.parent ? positionOf(row.parent) : null].filter(Boolean)
  const releaseRole = (record.extraartists ?? []).some((credit) => {
    if (idOf(credit) !== artistId || !isPerformingCredit(credit.role)) return false
    const scope = tracksInScope(credit.tracks, record.tracklist ?? [])
    return scope === null || positions.some((position) => scope.has(position))
  })
  if (releaseRole) return 'release-performer-role'
  // "A & B" on a record whose track names no one else: Discogs states
  // both are the performers of that track.
  if (rowArtists(row).length === 0 && jointlyCredited(record, artistId)) return 'joint-credit'
  // One track that names no artists of its own inherits the release
  // credit, and the release can only be about that track — provided the
  // release credits this artist at all (a master's main release is a
  // different pressing and may not).
  if (releaseCredited && tracks.length === 1 && rowArtists(row).length === 0) return 'single-track-record'
  return null
}

/**
 * { pass, reason?, via?, tiedBy?, track?, looseReadingPass } for one
 * record the video sits on. `aliases` are normalized name keys (they
 * let titleVariants drop the artist's own name from the upload title).
 */
export function sharedCreditVerdict({ artistId, record, uploadTitle, durationSeconds: uploadSeconds = null, aliases = new Set() }) {
  const id = Number(artistId)
  if (isCompilation(record)) return { pass: false, reason: 'compilation', looseReadingPass: false }
  const tracks = flatTracks(record.tracklist)
  const tied = tiedTracks(tracks, uploadTitle, uploadSeconds, aliases)
  const releaseCredited = (record.artists ?? []).some((credit) => idOf(credit) === id)
  if (tied.tracks.length === 0) {
    // An upload of the WHOLE record (its title is the record's own, no
    // track's): it plays every track, so every track needs the credit.
    const wholeRecord = tracks.length > 0 &&
      variantsIntersect(titleVariants(uploadTitle ?? '', aliases), titleVariants(record.title ?? '', aliases))
    if (wholeRecord) {
      const vias = tracks.map((row) => performerCredit(row, record, id, tracks, releaseCredited))
      if (vias.every(Boolean)) return { pass: true, via: vias[0], tiedBy: 'record-title', track: null, looseReadingPass: true }
      return { pass: false, reason: 'no-performer-credit-on-every-track', tiedBy: 'record-title', looseReadingPass: releaseCredited }
    }
    return { pass: false, reason: 'video-not-tied-to-a-track', looseReadingPass: false }
  }
  for (const row of tied.tracks) {
    const via = performerCredit(row, record, id, tracks, releaseCredited)
    if (via) return { pass: true, via, tiedBy: tied.by, track: row.position ?? null, looseReadingPass: true }
  }
  const looseReadingPass = releaseCredited && tied.tracks.some((row) => rowArtists(row).length === 0)
  return { pass: false, reason: 'no-performer-credit-on-track', tiedBy: tied.by, looseReadingPass }
}
