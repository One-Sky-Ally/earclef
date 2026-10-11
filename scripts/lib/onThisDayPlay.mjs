/**
 * Verified play links for "On this day" (owner, Oct 10 2026: "only
 * verified videos get a play button, and only playable songs go in the
 * playlist"). Pure: the build script feeds it Discogs records from the
 * local dump and checks playability with YouTube afterwards.
 *
 * THE BAR (the gap-fill play repair's, scripts/arbitrate-extra-play-
 * identity.mjs, made release-specific):
 *   · the record IS this release — exact title variant AND the same year
 *     (a reissue or a compilation carries another year or title);
 *   · ANCHOR by id: the artist's Discogs id (MusicBrainz's own url
 *     relation, never a name) is the record's whole credit, or is
 *     credited on the very track the video matches; a Various record
 *     never counts;
 *   · CORROBORATION: the video's title equals a track's or the record's
 *     (whole units, no fuzzy matching), or — on a whole credit — its
 *     length is within ±3 s of exactly one track.
 * Order: the release's own title first (the single, the title track),
 * then the record's other tracks as they run.
 */
import { durationSeconds, titleVariants, variantsIntersect } from './extraPlayIdentity.mjs'

const VARIOUS_ID = 194
const DURATION_TOLERANCE_S = 3

const creditIds = (credits) => (credits ?? []).map((credit) => Number(credit?.id ?? credit))

export function candidateVideos({ item, artistIds, records, aliases = new Set() }) {
  const wanted = titleVariants(item.t, aliases)
  const found = []
  const seen = new Set()
  for (const record of records) {
    if (item.dg ? record.id !== item.dg : record.year !== item.y) continue
    if (!variantsIntersect(wanted, titleVariants(record.title, aliases))) continue
    const ids = creditIds(record.artists)
    if (ids.length === 0 || ids.includes(VARIOUS_ID)) continue
    const whole = ids.every((id) => artistIds.has(id))
    const recordTitle = titleVariants(record.title, aliases)
    const tracks = record.tracklist ?? []
    const ranked = []
    for (const video of record.videos ?? []) {
      if (!video.videoId || seen.has(video.videoId)) continue
      const upload = titleVariants(video.title ?? '', aliases)
      const byTitle = tracks.findIndex((row) => variantsIntersect(upload, titleVariants(row.title, aliases)))
      let match = null
      if (byTitle !== -1) {
        match = { row: tracks[byTitle], order: byTitle, leg: 'title' }
      } else if (variantsIntersect(upload, recordTitle)) {
        match = { row: null, order: -1, leg: 'title' }
      } else if (whole && video.duration) {
        const timed = tracks
          .map((row, order) => ({ row, order, seconds: durationSeconds(row.duration) }))
          .filter((entry) => entry.seconds !== null && Math.abs(entry.seconds - video.duration) <= DURATION_TOLERANCE_S)
        if (timed.length === 1) match = { row: timed[0].row, order: timed[0].order, leg: 'duration' }
      }
      if (!match) continue
      const onTrack = match.row && creditIds(match.row.artists).some((id) => artistIds.has(id))
      if (!whole && !onTrack) continue
      const matchedTitle = match.row?.title ?? record.title
      // The release's own title ranks first, wherever it sits on the record.
      const isTitleSong = variantsIntersect(titleVariants(matchedTitle, aliases), wanted)
      ranked.push({
        videoId: video.videoId,
        title: video.title ?? '',
        matchedTitle,
        anchor: whole ? 'whole' : 'track',
        leg: match.leg,
        releaseId: record.id,
        rank: isTitleSong ? -1 : match.order,
      })
    }
    for (const candidate of ranked) seen.add(candidate.videoId)
    found.push(...ranked)
  }
  // Stable: records keep their order, and inside the ranking the
  // release's own title song leads.
  return found
    .sort((a, b) => a.rank - b.rank)
    .map((candidate) => Object.fromEntries(Object.entries(candidate).filter(([field]) => field !== 'rank')))
}
