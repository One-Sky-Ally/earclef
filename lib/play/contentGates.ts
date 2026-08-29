/**
 * Content gates: does a matched upload actually contain the SONG?
 *
 * Standing lesson 7 (owner-mandated, Aug 22 2026): a title match
 * verifies the NAME of a thing, never WHAT it is. A 9-second Short, a
 * film trailer, a behind-the-scenes reel and the record itself all
 * carry the song's exact title, so any match on a title needs a SECOND
 * check that the artifact is the kind of thing claimed.
 *
 * Two independent checks, first ported from scripts/build-hits-play.mjs
 * where they were encoded after the sweep shipped 8% bad play buttons:
 *   - a DURATION floor (kills Shorts, clips, stings)
 *   - NON_SONG_MARKERS against the ANNOTATION only (kills trailers,
 *     interviews, making-ofs — the class that passes any length rule)
 *
 * KNOWN BLIND SPOT, stated rather than assumed: a floor passes
 * truncated or abbreviated uploads. Blondie's "Call Me" resolves to a
 * 135s upload when MB's shortest legitimate recording is 175s, and no
 * length rule short of cross-checking MB recording lengths would catch
 * it — MB's own lengths are noisy enough that such a check would cost
 * more truth than it buys.
 */

/**
 * A song is not nine seconds long. Floor only: official videos
 * legitimately run long (Michael Jackson's "Black or White" is 11
 * minutes), so a ceiling would cut real records.
 */
export const MIN_DURATION_SECONDS = 90

/**
 * Annotations that change WHAT the upload is, not merely how it is
 * labelled. Stripping "(Official Video)" to compare titles is right;
 * stripping "(Behind The Scenes)" is how a making-of became a #1 hit's
 * play button. Tested against the annotation only, so a song whose own
 * title contains one of these words is unaffected.
 */
export const NON_SONG_MARKERS =
  /\b(trailer|teaser|behind the scenes|making of|documentary|interview|preview|snippet|clip|reaction|announcement|album sampler)\b/i

/**
 * Script-aware normalize: the ASCII-only version reduced non-Latin
 * names and titles to '', and '' === '' passes every comparison
 * (standing lesson 5 — missing is not a match).
 */
const normalize = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

/**
 * What is left of an upload title once the artist prefix and the
 * matched work title are removed — "Live and Let Die (Official Video)"
 * annotates to "official video", never to "live", because the word
 * lives inside the MATCHED portion. That scoping is what makes marker
 * tests safe against songs whose own titles contain marker words.
 */
export function annotationOf(
  uploadTitle: string,
  workTitle: string,
  artistName: string,
): string {
  const upload = normalize(uploadTitle)
  const title = normalize(workTitle)
  const artist = normalize(artistName)
  if (!upload || !title) return ''
  const rest = artist && upload.startsWith(`${artist} `)
    ? upload.slice(artist.length).trim()
    : upload
  const at = rest.indexOf(title)
  if (at === -1) return rest
  return `${rest.slice(0, at)} ${rest.slice(at + title.length)}`.trim()
}

/**
 * True when the upload announces itself as something other than the
 * record. An empty annotation asserts nothing and so gates nothing —
 * absence is not evidence either way (standing lesson 5).
 */
export function isNonSongUpload(
  uploadTitle: string,
  workTitle: string,
  artistName: string,
): boolean {
  const annotation = annotationOf(uploadTitle, workTitle, artistName)
  return annotation ? NON_SONG_MARKERS.test(annotation) : false
}

/** ISO-8601 duration (YouTube contentDetails) → seconds; 0 if absent. */
export function durationSeconds(iso: string | undefined): number {
  const match = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso ?? '')
  if (!match) return 0
  const [hours, minutes, seconds] = match
    .slice(1)
    .map((part) => Number(part ?? 0))
  return hours * 3600 + minutes * 60 + seconds
}

/** Long enough to be a record rather than a Short or a sting. */
export function isSongLength(iso: string | undefined): boolean {
  return durationSeconds(iso) >= MIN_DURATION_SECONDS
}
