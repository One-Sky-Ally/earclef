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
 *
 * NON-ENGLISH COGNATES were added Aug 31, 2026 when multi-track
 * queues began matching whole catalogues instead of one best title:
 * depth surfaced "Dimanche à Bamako (Documentaire)" on Amadou &
 * Mariam's own channel, which every English-only marker passed. The
 * site is global; its junk annotations are too. Karaoke joins them
 * for a different reason — it IS music, but it is not the artist's
 * record, and a queue claiming the sound of a place must not play a
 * backing track with the vocals stripped out.
 *
 * Language coverage is honestly partial — these are the classes seen
 * in real yields, not a solved problem.
 *
 * SERIES AND EVENT MARKERS (episode, epk, press kit, aftershow,
 * listening party, webisode, docuseries) were added Aug 2026 after
 * three more non-songs were found opening real queues: Bob Marley's
 * "LEGACY … | Episode V" (22m, matched because Punky Reggae Party is a
 * real release group), Peter Gabriel's "OVO - The Millennium Show. EPK"
 * (18m), and a 44-minute "Twitter Listening Party Aftershow".
 *
 * DELIBERATELY ABSENT: `part` and `pt.`. Real records are numbered —
 * "The Industry - Dark Side Version, Pt.1" is a legitimate track in
 * Egypt's own queue — so a part-number marker would cost music.
 */
export const NON_SONG_MARKERS =
  /\b(trailer|teaser|behind the scenes|making of|documentary|interview|preview|snippet|clip|reaction|announcement|album sampler|karaoke|karaoke version|documentaire|documental|reportage|entrevista|entretien|bande annonce|episode|epk|press kit|aftershow|listening party|webisode|docuseries)\b/i

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

/**
 * ────────────────────────────────────────────────────────────────────
 * A PLAYLIST SHOULD ALWAYS PLAY MUSIC (owner ruling, Aug 2026)
 * ────────────────────────────────────────────────────────────────────
 *
 * Three non-songs opened real queues — a documentary episode (Jamaica
 * 1961), a TV talk-show appearance (Egypt 2020), and an artist talking
 * about his own album (Panama 2020). All three are on the artist's OWN
 * channel, so identity was never wrong; all three are long enough to
 * pass the duration floor; and none carries a marker word in its title.
 *
 * MEASURED AGAINST 170 REAL QUEUE TRACKS drawn from six place+era
 * combos (JM 1961, GB 1965, US 1972, BR 1975, EG 2020, NG 1978), which
 * is how the following were ruled OUT as gates:
 *
 *   - categoryId. Useless: 163 of 170 are category 10 (Music) — every
 *     bad one included. Inverting it flags four legitimate Gilberto Gil
 *     live tracks and Crescent's Wacken set.
 *   - A duration CEILING. Fela Kuti's real records run 10–30 minutes
 *     ("Confusion" is 25m37s), so any ceiling tight enough to catch a
 *     22-minute documentary guts Nigeria's queue — and would still miss
 *     the TV appearance, which is 3m50s, exactly song length.
 *   - A streaming link in the description. 38% of legitimate tracks
 *     have none, including the Beatles, King Tubby and Burning Spear —
 *     the archival material this site exists for — while the Marley
 *     documentary has one.
 *
 * What survived is three narrow signals whose UNION caught all six
 * non-songs in the sample with zero false positives. None is
 * sufficient alone: each catches something the others miss.
 */

/**
 * YouTube's own knowledge-graph classification of the video. This is
 * the only signal here that is INDEPENDENT of text the uploader wrote,
 * which is exactly what standing lesson 7 asks for — a second check
 * that the artifact is the kind of thing claimed.
 *
 * KNOWN FALSE-POSITIVE MODE, measured not assumed: on third-party
 * REUPLOADS of Top of the Pops and Beat-Club, this flags genuine
 * performances (Bowie's lost "Jean Genie", Alice Cooper's "School's
 * Out"). Those live on channels the resolver already refuses — it takes
 * the artist's own MB-linked channel or a strictly verified search — so
 * the sample of 170 real candidates contained none. The residual risk
 * is an official channel's own broadcast upload, which is why this
 * signal alone is reversible by the release valve and the other two
 * are not.
 */
const TELEVISION_TOPIC = 'Television_program'

export function isTelevisionProgramme(topicUrls: string[] | undefined): boolean {
  // Absence is not evidence (standing lesson 5): a video with no topic
  // data asserts nothing, and must not be read as "not television".
  if (!topicUrls || topicUrls.length === 0) return false
  return topicUrls.some((url) => {
    const leaf = url.split('/').pop()
    return leaf ? decodeURIComponent(leaf) === TELEVISION_TOPIC : false
  })
}

/**
 * The video describing itself as SPEECH ABOUT music rather than music.
 * Rubén Blades' "RUBEN BLADES Y PASIEROS…" opens Panama 2020 and is
 * four minutes of him discussing the album; its only tell is the first
 * description line, "RUBÉN comenta en el video…".
 *
 * Two calibrations, both forced by measurement:
 *   - FIRST LINE ONLY. Descriptions carry boilerplate, credits and tour
 *     text; matching the whole field flagged five legitimate Elton John
 *     tracks whose boilerplate mentions a documentary.
 *   - NO `documentary` / `interview` / `behind the scenes` HERE, though
 *     they are title markers. The Who's official promo film for "Who
 *     Are You" describes being filmed for Jeff Stein's documentary —
 *     the music video would have been deleted by its own provenance.
 */
export const SPEECH_ABOUT_MUSIC =
  /\b(comenta|habla sobre|habla de|fala sobre|parle de|talks about|speaks about|discusses|in conversation with)\b/i

export function describesTalkingAboutMusic(
  description: string | undefined,
): boolean {
  const firstLine = (description ?? '').split('\n')[0]
  return firstLine ? SPEECH_ABOUT_MUSIC.test(firstLine) : false
}

/**
 * Why a candidate is not music. Empty reasons means nothing objected.
 *
 * The reasons are named rather than reduced to a boolean because they
 * differ in KIND: `title-marker` and `describes-talking` are the upload
 * describing itself, while `television-topic` is a classifier's
 * inference with a measured false-positive mode. A design that
 * reinstated inferred-only verdicts was built and removed — see the
 * resolver — but the distinction is real and worth keeping visible.
 */
export interface NonMusicVerdict {
  reasons: string[]
}

export function nonMusicVerdict(input: {
  title: string
  workTitle: string
  artistName: string
  topicUrls?: string[]
  description?: string
}): NonMusicVerdict {
  const reasons: string[] = []
  if (isNonSongUpload(input.title, input.workTitle, input.artistName)) {
    reasons.push('title-marker')
  }
  if (describesTalkingAboutMusic(input.description)) {
    reasons.push('describes-talking')
  }
  if (isTelevisionProgramme(input.topicUrls)) reasons.push('television-topic')
  return { reasons }
}
