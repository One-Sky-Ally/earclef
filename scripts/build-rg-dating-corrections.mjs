/**
 * STAGE 3 — ARBITRATION. Turns gathered evidence into corrections.
 *
 * Nothing here touches the site. It writes a corrections dataset and a
 * held list; Stage 4 (its own go) applies them at read time, the way
 * origin-corrections already works.
 *
 * ═══ THE OWNER'S RULES, AS IMPLEMENTED ═══════════════════════════════
 *
 * THE PRINCIPLE (Sep 1): a track belongs to the year its RECORDING was
 * made. For a compilation that is the original recording; for a live
 * album or a re-recording it is the performance, so those stay in their
 * release year.
 *
 * 1. LIVE IS NEVER TOUCHED. A MusicBrainz `Live` secondary type means
 *    the recording IS the release-year performance. 14,743 candidates
 *    (6.2%) carry it — free and definitive.
 *
 * 2. ONLY COMPILATIONS AND RETROSPECTIVES GET PER-SONG DATING. This one
 *    rule is what makes re-recordings safe WITHOUT a classifier: a 1985
 *    re-recording of a 1964 song is its own album, not comp-tagged, so
 *    the 1964 evidence never reaches it. The same evidence still
 *    re-dates the 2001 compilation bearing that title. Performance-year
 *    placement falls out of the structure rather than being detected.
 *
 * 3. PER-SONG BEATS PER-ALBUM. Where a song has its own dated evidence
 *    it uses that year regardless of the album's verdict — a 2012
 *    compilation holding a 1991 track and a 2012 track places each in
 *    its own year.
 *
 * 4. THE ALBUM THRESHOLD IS 3 YEARS, and applies ONLY to songs that
 *    could not be dated individually. Newest individually-dated track
 *    vs release year: a gap of 3+ years means the album looks backward,
 *    and its undated songs inherit its span. Under 3 years it is a
 *    current record and they keep the release year.
 *
 * 5. NO EVIDENCE, NO MOVE. Silence leaves the music exactly where it is.
 *
 * ═══ IDENTITY, INHERITED FROM STAGE 2 ════════════════════════════════
 * Every piece of evidence carries the tier that established identity:
 * `id-crosswalk` (MB's own Discogs relation), `wikidata-hop` (MB →
 * Wikidata P1953, with a P434 round-trip), `name-unique` (exactly one
 * Discogs artist of that exact name). The owner ruled name-unique
 * ADMISSIBLE but asked it be strengthened, so it must additionally
 * clear a CAREER-WINDOW OVERLAP: the matched catalogue has to overlap
 * the artist's documented working life. Hugo Wolf (d. 1903, catalogue
 * 1932-1995 — all posthumous performances) fails this and stays put.
 * Discogs profile life-dates, where the addendum pass found them, ride
 * along as a second independent leg (recorded, never auto-decisive).
 *
 * ═══ WHAT IS DELIBERATELY NOT BUILT ══════════════════════════════════
 * No live-album classifier. Titles smelling of live performance
 * ("en vivo", "live at") that MusicBrainz did NOT tag are only 987
 * records (0.4%) — they go to the HELD list for human eyes, because a
 * title can nominate for review but never convict (standing lesson 7).
 * No recording-MBID reuse analysis: it only works where MusicBrainz
 * already documents the originals, which is exactly the class needing
 * no help.
 *
 * Outputs (all gitignored working data; Stage 4 decides what ships):
 *   data/rg-dating-corrections.json  song years + album verdicts
 *   data/rg-dating-held.json         cases reserved for the owner
 *
 * Usage: node scripts/build-rg-dating-corrections.mjs [--report]
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const SWEEP_DIR = 'data/rg-dating-sweep'
const EVIDENCE_DIR = 'data/rg-dating-evidence'
const TRACKLIST_DIR = 'data/mb-dump/rg-tracklists'
const PROFILES_PATH = 'data/rg-dating-profiles.json'
const CORRECTIONS_PATH = 'data/rg-dating-corrections.json'
const HELD_PATH = 'data/rg-dating-held.json'
const RESOLUTIONS_PATH = 'data/rg-dating-resolutions.json'

/** Owner ruling, Sep 1: 3+ years older than release = looking backward. */
const RETROSPECTIVE_GAP_YEARS = 3
/** Career-window slack, absorbing the birth+15 proxy's coarseness. */
const WINDOW_SLACK_YEARS = 2

/**
 * Titles that SMELL live but carry no MusicBrainz Live tag. Nominates
 * for the held list only — never a verdict (standing lesson 7).
 */
/** Owner review bar (Sep 1): bare-word cases below this stay put. */
const REVIEW_STAKE_THRESHOLD = 8
/** Boxes explicitly holding BOTH studio and live material. */
const LIVE_MIXED_BOX =
  /\b(studio.{0,8}(&|and|\+|et).{0,8}live|live.{0,8}(&|and|\+|et).{0,8}(studio|rare|bonus)|plus bonus)\b/i
/** Titles naming a venue, occasion or date — almost certainly live. */
const LIVE_EXPLICIT =
  /\b(live (at|in|aus|im)|en vivo en|ao vivo (no|em)|unplugged|in concert)\b|\b(19|20)\d\d\b/i

const LIVE_LEXICON =
  /\b(live|en vivo|ao vivo|em directo|dal vivo|in concert|unplugged|live at|live in|concierto|konzert|koncert|концерт)\b/i

const titleKey = (value) =>
  (value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

const tracklistCache = new Map()
function tracklistFor(rgId) {
  const shard = rgId.slice(0, 2)
  let map = tracklistCache.get(shard)
  if (!map) {
    map = new Map()
    const path = join(TRACKLIST_DIR, `${shard}.jsonl`)
    if (existsSync(path)) {
      for (const line of readFileSync(path, 'utf8').split('\n')) {
        if (!line) continue
        try {
          const row = JSON.parse(line)
          map.set(row.g, row.t)
        } catch {
          // One bad line must not blind the shard.
        }
      }
    }
    tracklistCache.set(shard, map)
  }
  return map.get(rgId) ?? []
}

function loadEvidence() {
  const byArtist = new Map()
  if (!existsSync(EVIDENCE_DIR)) return byArtist
  for (const file of readdirSync(EVIDENCE_DIR).filter((f) => f.endsWith('.json'))) {
    const shard = JSON.parse(readFileSync(join(EVIDENCE_DIR, file), 'utf8'))
    for (const artist of shard.artists) {
      if (artist.status === 'checked') byArtist.set(artist.id, artist)
    }
  }
  return byArtist
}

function loadProfiles() {
  if (!existsSync(PROFILES_PATH)) return {}
  try {
    return JSON.parse(readFileSync(PROFILES_PATH, 'utf8')).artists ?? {}
  } catch {
    return {}
  }
}

/**
 * Is this evidence admissible for this artist?
 *
 * id-crosswalk and wikidata-hop are ID-level and pass on their own.
 * name-unique carries the owner's strengthening: the matched Discogs
 * catalogue must overlap the artist's documented working life, or the
 * "match" is describing somebody else's records.
 */
function admissible(artist) {
  if (artist.tier !== 'name-unique') return { ok: true, why: artist.tier }
  const earliest = artist.context?.earliest
  const latest = artist.context?.latest
  if (earliest === null || latest === null || earliest === undefined) {
    return { ok: false, why: 'name-unique-no-catalogue-dates' }
  }
  const lo = artist.cs ?? -Infinity
  const hi = artist.end ?? 2026
  const overlaps =
    earliest <= hi + WINDOW_SLACK_YEARS && latest >= lo - WINDOW_SLACK_YEARS
  return overlaps
    ? { ok: true, why: 'name-unique-window-ok' }
    : { ok: false, why: 'name-unique-window-mismatch' }
}

function main() {
  const evidence = loadEvidence()
  const profiles = loadProfiles()
  const resolutionsFile = existsSync(RESOLUTIONS_PATH)
    ? JSON.parse(readFileSync(RESOLUTIONS_PATH, 'utf8'))
    : {}
  const resolutions = resolutionsFile.resolved ?? {}
  /**
   * Owner ruling (Sep 1, "cheap insurance"): artists whose name-unique
   * identity has an unresolved profile disagreement contribute NOTHING
   * until each is eyeballed. Their held entries remain visible; their
   * corrections are withheld entirely.
   */
  const quarantined = resolutionsFile.quarantined ?? {}
  console.log(`artists with evidence: ${evidence.size.toLocaleString()}`)

  /** artistMbid → { [titleKey]: {y, src, tier} } */
  const songYears = {}
  /** rgId → verdict record (written once, after accumulation) */
  const albums = {}
  /** rgId → evidence accumulated across every credited artist */
  const albumAcc = new Map()
  const held = []
  const stats = {
    candidates: 0,
    liveUntouched: 0,
    notCompUntouched: 0,
    posthumousUntagged: 0,
    songRejectedPostDeath: 0,
    inadmissible: 0,
    songMoves: 0,
    albumRetro: 0,
    albumCurrent: 0,
    albumNoDates: 0,
    heldLiveLexicon: 0,
    heldProfileDisagrees: 0,
  }

  for (const file of readdirSync(SWEEP_DIR).filter((f) => f.endsWith('.json'))) {
    const country = file.replace(/\.json$/, '')
    const shard = JSON.parse(readFileSync(join(SWEEP_DIR, file), 'utf8'))
    for (const artist of shard.artists) {
      if (artist.candidates.length === 0) continue
      const ev = evidence.get(artist.id)
      if (!ev) continue

      if (quarantined[artist.id]) {
        stats.quarantinedArtists = (stats.quarantinedArtists ?? 0) + 1
        held.push({
          kind: 'quarantined-profile-disagrees',
          country,
          artist: artist.name,
          mbid: artist.id,
          affectedRecords: artist.candidates.length,
          detail: quarantined[artist.id].detail,
        })
        continue
      }
      const gate = admissible(ev)
      const years = new Map((ev.titleYears ?? []).map(([key, year]) => [key, year]))
      const profile = profiles[artist.id]
      // A profile that contradicts MusicBrainz does not veto — prose is
      // volunteer-written and a typo looks like a mismatch — but it is
      // surfaced for the owner rather than absorbed silently.
      if (
        profile?.verdict === 'disagrees' &&
        ev.tier === 'name-unique' &&
        // Already settled by independent evidence (Wikidata tie-break
        // confirming MusicBrainz) — see rg-dating-resolutions.json.
        !resolutions[artist.id]
      ) {
        held.push({
          kind: 'profile-disagrees',
          country,
          artist: artist.name,
          mbid: artist.id,
          mbCs: artist.cs,
          mbEnd: artist.end,
          profileBorn: profile.profileBorn,
          profileDied: profile.profileDied,
          profileText: profile.profileText,
          affectedRecords: artist.candidates.length,
        })
        stats.heldProfileDisagrees += 1
      }

      for (const candidate of artist.candidates) {
        stats.candidates += 1
        const secondary = candidate.secondary ?? []

        // RULE 1 — live is the release-year performance. Never touched.
        if (secondary.includes('Live')) {
          stats.liveUntouched += 1
          continue
        }

        /*
         * RULE 2 — per-song dating reaches compilations AND posthumous
         * releases; everything else keeps its own date.
         *
         * The compilation tag alone was too narrow, and the founding
         * case proved it: Julio Sosa died in 1964, and 12 of his 20
         * candidates are posthumous WITHOUT a Compilation tag —
         * "30 aniversario 1964-1994", "La historia de Julio Sosa" —
         * so tag-only dating skipped 60% of exactly the records that
         * make Uruguay's 1990s wrong. MusicBrainz not applying a tag is
         * a data-quality gap, not a statement about the music.
         *
         * Extending to posthumous releases is SAFE for the precise
         * reason rule 2 exists at all. Its job is protecting
         * re-recordings — and an artist who was already dead cannot
         * have re-recorded anything, so no release after their death
         * can be one. A LIVING artist's untagged album still keeps its
         * own date: Racciatti's "Bien milonguero" (1996, he died 2000)
         * stays exactly where it is, which is the Buena Vista
         * protection working as designed.
         */
        const isComp = secondary.includes('Compilation')
        const posthumous = artist.end !== null && candidate.year > artist.end
        if (!isComp && !posthumous) {
          stats.notCompUntouched += 1
          continue
        }
        if (!isComp) stats.posthumousUntagged += 1

        if (!gate.ok) {
          stats.inadmissible += 1
          continue
        }

        // A compilation MusicBrainz never tagged Live, whose title
        // smells of performance: nominate for review, never convict.
        // A case with NOTHING at stake — no track of it can be dated
        // anyway — decides nothing either way, so holding it would only
        // pad the owner's queue (lesson 8: what would they DO with it?).
        if (LIVE_LEXICON.test(candidate.title)) {
          const tracksHere = tracklistFor(candidate.id)
          let stake = 0
          for (const track of tracksHere) {
            const y = years.get(titleKey(track))
            if (y !== undefined && y < candidate.year) stake += 1
          }
          /*
           * Owner rulings, Sep 1 — the lexicon class is settled by rule,
           * not case-by-case:
           *   zero stake      → nothing to decide, not held.
           *   mixed box       → stays put PERMANENTLY. "Intégrale
           *                     studio & live" defeats per-title dating:
           *                     the studio and live takes share titles.
           *   explicit live   → stays put PERMANENTLY ("Live at…",
           *                     "En vivo en…" — almost certainly live).
           *   bare word, <8   → stays put (below the review bar).
           *   bare word, >=8  → HELD for the owner's 96-case review.
           */
          if (stake === 0) {
            stats.heldLiveZeroStake = (stats.heldLiveZeroStake ?? 0) + 1
            continue
          }
          if (LIVE_MIXED_BOX.test(candidate.title)) {
            stats.liveMixedBoxStays = (stats.liveMixedBoxStays ?? 0) + 1
            continue
          }
          if (LIVE_EXPLICIT.test(candidate.title)) {
            stats.liveExplicitStays = (stats.liveExplicitStays ?? 0) + 1
            continue
          }
          if (stake < REVIEW_STAKE_THRESHOLD) {
            stats.liveBareLowStays = (stats.liveBareLowStays ?? 0) + 1
            continue
          }
          held.push({
            stake,
            kind: 'live-lexicon-untagged',
            country,
            artist: artist.name,
            mbid: artist.id,
            rg: candidate.id,
            title: candidate.title,
            mbYear: candidate.year,
          })
          stats.heldLiveLexicon += 1
          continue
        }

        // RULE 3 — per-song first. Every track we can date individually
        // gets its own year, whatever the album turns out to be.
        const tracks = tracklistFor(candidate.id)
        const dated = []
        for (const track of tracks) {
          const key = titleKey(track)
          const year = years.get(key)
          // A "correction" must move the song EARLIER than the album;
          // a later year is not an original recording.
          if (year === undefined || year >= candidate.year) continue
          /*
           * A RECORDING CANNOT POSTDATE THE ARTIST. Discogs years are
           * RELEASE years, and for a dead artist whose every pressing
           * of a song is a posthumous reissue, the earliest pressing
           * still lands after their death — which is a lower BOUND on
           * the record's age, not the year it was recorded. Taking it
           * as a date produced visibly impossible output: Julio Sosa
           * (d. 1964) drew spans of "1965–1991".
           *
           * So evidence dated after the artist's death is not evidence
           * of an original, and the song simply stays put. That loses
           * corrections and keeps the ones that survive honest — the
           * same direction every other rule here errs in.
           */
          if (artist.end !== null && year > artist.end) {
            stats.songRejectedPostDeath += 1
            continue
          }
          dated.push({ key, title: track, year })
        }

        for (const song of dated) {
          const bucket = (songYears[artist.id] ??= {})
          const existing = bucket[song.key]
          // Earliest wins: the first pressing is the recording's year.
          if (!existing || song.year < existing.y) {
            bucket[song.key] = { y: song.year, tier: ev.tier, t: song.title }
            if (!existing) stats.songMoves += 1
          }
        }

        /*
         * RULE 4 — accumulate now, decide once at the end.
         *
         * A release group credited to SEVERAL artists is visited once
         * per artist, and writing the verdict here let the last artist
         * processed overwrite the others. That is not a tie-break, it
         * is data loss with a death constraint attached: Julio Sosa
         * (d. 1964) shares "Zorzales de Antaño" with Armando Pontier,
         * and Pontier's unconstrained pass rewrote Sosa's span back to
         * an impossible 1965-1981. An album's evidence is the UNION of
         * what every credited artist can prove, each already filtered
         * by their own lifetime.
         */
        const acc = albumAcc.get(candidate.id) ?? {
          mbYear: candidate.year,
          title: candidate.title,
          tracks: tracks.length,
          dated: new Map(),
          artists: [],
          artistIds: [],
          tiers: new Set(),
          country,
        }
        for (const song of dated) {
          const held = acc.dated.get(song.key)
          if (held === undefined || song.year < held) acc.dated.set(song.key, song.year)
        }
        acc.artists.push(artist.name)
        acc.artistIds.push(artist.id)
        acc.tiers.add(ev.tier)
        albumAcc.set(candidate.id, acc)
      }
    }
  }

  // Verdicts, computed once per album from the pooled evidence.
  for (const [rgId, acc] of albumAcc) {
    const years = [...acc.dated.values()]
    if (years.length === 0) {
      stats.albumNoDates += 1
      albums[rgId] = {
        verdict: 'no-evidence',
        mbYear: acc.mbYear,
        tracks: acc.tracks,
        dated: 0,
      }
      continue
    }
    const newest = Math.max(...years)
    const oldest = Math.min(...years)
    const retrospective = acc.mbYear - newest >= RETROSPECTIVE_GAP_YEARS
    if (retrospective) stats.albumRetro += 1
    else stats.albumCurrent += 1
    albums[rgId] = {
      verdict: retrospective ? 'retrospective' : 'current',
      mbYear: acc.mbYear,
      /** Era the album represents — a SPAN, never an invented year. */
      span: retrospective ? [oldest, newest] : null,
      tracks: acc.tracks,
      dated: years.length,
      undated: acc.tracks - years.length,
      artists: acc.artists,
      artistIds: acc.artistIds,
      title: acc.title,
      tiers: [...acc.tiers],
      country: acc.country,
    }
  }

  /*
   * INTEGRITY AUDIT — a span cannot end after every credited artist
   * has finished. Where it does, either a MusicBrainz end date or a
   * Discogs year is wrong, and the case is surfaced rather than shipped
   * (this caught the shared-release-group overwrite that produced
   * "1965-1991" spans for Julio Sosa, who died in 1964).
   */
  /*
   * KEYED BY MBID, NOT NAME. The first version keyed this map by name
   * and manufactured 38 false impossibilities out of name collisions:
   * the Austrian band Opus (no end date) inherited some other Opus's
   * end year, and "Nena" the 1982-87 band collided with Nena the solo
   * artist whose 1990s recordings are perfectly real. Names are labels;
   * only the MBID identifies (the same lesson as every crosswalk here).
   */
  const artistEnds = new Map()
  for (const file of readdirSync(SWEEP_DIR).filter((f) => f.endsWith('.json'))) {
    const shard = JSON.parse(readFileSync(join(SWEEP_DIR, file), 'utf8'))
    for (const artist of shard.artists) artistEnds.set(artist.id, artist.end)
  }
  for (const [rgId, album] of Object.entries(albums)) {
    if (!album.span || !album.artistIds) continue
    const latestEnd = Math.max(
      ...album.artistIds.map((id) => artistEnds.get(id) ?? 2026),
    )
    if (album.span[1] > latestEnd) {
      held.push({
        kind: 'span-after-artist-ended',
        rg: rgId,
        title: album.title,
        artists: album.artists,
        span: album.span,
        latestArtistEnd: latestEnd,
        mbYear: album.mbYear,
        country: album.country,
      })
      stats.heldImpossibleSpan = (stats.heldImpossibleSpan ?? 0) + 1
      // Not shipped as a verdict: the evidence contradicts itself.
      album.verdict = 'held-impossible'
      album.span = null
    }
  }

  const songCount = Object.values(songYears).reduce(
    (sum, bucket) => sum + Object.keys(bucket).length,
    0,
  )
  writeFileSync(
    CORRECTIONS_PATH,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        rules: {
          retrospectiveGapYears: RETROSPECTIVE_GAP_YEARS,
          liveNeverTouched: true,
          onlyCompilationsRedated: true,
          perSongBeatsPerAlbum: true,
        },
        stats,
        songYears,
        albums,
      },
      null,
      1,
    ) + '\n',
  )
  writeFileSync(
    HELD_PATH,
    JSON.stringify({ generatedAt: new Date().toISOString(), held }, null, 1) + '\n',
  )

  console.log(`\n════ STAGE 3 — ARBITRATION ════`)
  console.log(`candidates examined      : ${stats.candidates.toLocaleString()}`)
  console.log(`  live, never touched    : ${stats.liveUntouched.toLocaleString()}`)
  console.log(`  not comp, artist living: ${stats.notCompUntouched.toLocaleString()} (re-recording protection)`)
  console.log(`  posthumous, untagged   : ${stats.posthumousUntagged.toLocaleString()} (reached by the rule-2 extension)`)
  console.log(`  evidence inadmissible  : ${stats.inadmissible.toLocaleString()}`)
  console.log(`  song evidence rejected as post-death: ${stats.songRejectedPostDeath.toLocaleString()}`)
  console.log(`\nSONG-LEVEL corrections   : ${songCount.toLocaleString()} songs across ${Object.keys(songYears).length.toLocaleString()} artists`)
  console.log(`ALBUM verdicts           : retrospective ${stats.albumRetro.toLocaleString()} · current ${stats.albumCurrent.toLocaleString()} · no-evidence ${stats.albumNoDates.toLocaleString()}`)
  console.log(`HELD for the owner       : ${held.length.toLocaleString()} (live-lexicon ${stats.heldLiveLexicon}, profile-disagrees ${stats.heldProfileDisagrees}, impossible-span ${stats.heldImpossibleSpan ?? 0})`)
  console.log(`\n→ ${CORRECTIONS_PATH}\n→ ${HELD_PATH}`)
}

main()
