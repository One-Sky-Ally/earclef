/**
 * Gap-fill play repair — ARBITRATION (local, re-runnable, no network).
 *
 *   node scripts/arbitrate-extra-play-identity.mjs [--report path] [--verbose]
 *
 * Reads data/extra-play-evidence/*.json (gather-extra-play-evidence.mjs)
 * and rules on every artist. Writes a report; it does NOT touch the
 * committed dataset (that is the apply step, its own owner go).
 *
 * THE BAR — one ID-level ANCHOR plus one independent CORROBORATION,
 * every comparison exact over whole units (see lib/extraPlayIdentity):
 *   anchor   whole   the video is attached to a Discogs record whose
 *                    every structured credit is this artist id
 *            track   attached to a record where this artist is credited
 *                    on a track, and the video's title equals THAT track
 *            channel the video's channel id equals a channel MusicBrainz
 *                    or Discogs links to this artist (UC… ids only)
 *   corrob.  title   upload title variant equals a title on the anchor
 *                    record (track or record title), or — for the
 *                    crosswalked — an MB release-group/track title
 *            duration YouTube length within ±3 s of a Discogs track length
 *            topic    channel title equals "<alias> - Topic" (exact);
 *                     corroboration only, never an anchor (a same-name
 *                     act's Topic channel would pass a name test)
 * REFUTED  the stored video sits only on records where this artist has
 *          no credit, or on a compilation where its title matches a
 *          track credited to someone else.
 * HELD     everything else — anchor without corroboration, or the video
 *          could not be located on any fetched record.
 *
 * Artist verdict: stored video verified → verified; else the best
 * verified candidate (playable, ≥90 s) → replaced; else stored refuted
 * → refuted; else held. NOTHING IS DELETED: every verdict keeps the
 * stored URL and records its evidence legs.
 *
 * OWNER RULINGS (Sep 3, 2026, with the step-2 go): (a) a SHARED credit
 * (the artist beside others on the record) is an accepted anchor;
 * (b) DURATION-ONLY corroboration on a whole credit is accepted;
 * (c) a stored link that is HELD is REPLACED when a verified candidate
 * exists. All three are the behaviour encoded above.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  EVIDENCE_DIR, ROOT, DISCOGS_VARIOUS_ID, normalizeName, aliasKeys, titleVariants,
  variantsIntersect, durationSeconds, channelIdsFromUrls, stripDiscogsDisambiguator,
  titleNamesArtist, isPerformingRole,
} from './lib/extraPlayIdentity.mjs'

const argOf = (flag, fallback) => {
  const index = process.argv.indexOf(flag)
  return index !== -1 ? process.argv[index + 1] : fallback
}
const REPORT_PATH = argOf('--report', join(ROOT, 'data', 'extra-play-identity-report.json'))
const VERBOSE = process.argv.includes('--verbose')
const DURATION_TOLERANCE_S = 3
const MIN_SONG_SECONDS = 90
const ANCHOR_RANK = { whole: 0, track: 1, shared: 2, featured: 3, channel: 4 }

const youtube = existsSync(join(EVIDENCE_DIR, 'youtube.json'))
  ? JSON.parse(readFileSync(join(EVIDENCE_DIR, 'youtube.json'), 'utf8'))
  : {}

function recordTitleVariants(record, aliases) {
  const variants = new Set(titleVariants(record.title, aliases))
  for (const track of record.tracklist) for (const key of titleVariants(track.title, aliases)) variants.add(key)
  return variants
}

function anchorsFor(videoId, evidence, aliases, artistChannelIds) {
  const id = Number(evidence.discogsId)
  const anchors = []
  const uncredited = []
  const heldOn = []
  const upload = titleVariants(youtube[videoId]?.title ?? '', aliases)
  for (const record of evidence.records) {
    if (!record.videos.some((v) => v.videoId === videoId)) continue
    if (record.replayOfMasterId) {
      // The record the ORIGINAL sweep mis-fetched (master id read as a
      // release id). It is not this artist's record and never anchors.
      uncredited.push({ record, reason: 'master-id-collision' })
      continue
    }
    const whole = record.artists.length > 0 && record.artists.every((a) => a.id === id)
    const perTrackCredits = record.tracklist.some((t) => t.artists.length > 0)
    const shared = !whole && record.artists.some((a) => a.id === id) && !perTrackCredits
    if (whole || shared) {
      // whole: the record is this artist's alone. shared: credited
      // beside others on a record WITHOUT per-track credits (a band +
      // its singer, a duet). A shared record WITH per-track credits is
      // a split — each side belongs to someone — and falls through to
      // the track-level rule below (owner-approved class, Sep 3).
      anchors.push({ kind: whole ? 'whole' : 'shared', record, titles: recordTitleVariants(record, aliases), durations: record.tracklist.map((t) => durationSeconds(t.duration)).filter(Boolean) })
      continue
    }
    const performingRoles = (roles) => roles.some((a) => a.id === id && isPerformingRole(a.role))
    const nonPerformingOnly = (roles) => roles.some((a) => a.id === id) && !performingRoles(roles)
    const ownTracks = record.tracklist.filter((t) => t.artists.includes(id) || performingRoles(t.extraartists ?? []))
    const featuredOnRecord = performingRoles(record.extraartists ?? [])
    const creditedNonPerforming = nonPerformingOnly(record.extraartists ?? []) || record.tracklist.some((t) => nonPerformingOnly(t.extraartists ?? []))
    if (ownTracks.length || featuredOnRecord) {
      const pool = ownTracks.length ? ownTracks : record.tracklist
      const matched = pool.filter((t) => variantsIntersect(upload, titleVariants(t.title, aliases)))
      if (matched.length) {
        const kind = matched.some((t) => t.artists.includes(id)) ? 'track' : 'featured'
        anchors.push({ kind, record, titles: new Set(matched.flatMap((t) => [...titleVariants(t.title, aliases)])), durations: matched.map((t) => durationSeconds(t.duration)).filter(Boolean) })
        continue
      }
      const otherTrack = record.tracklist.find((t) => !t.artists.includes(id) && t.artists.length && variantsIntersect(upload, titleVariants(t.title, aliases)))
      if (otherTrack) uncredited.push({ record, reason: 'title-matches-other-artist-track' })
      else heldOn.push({ record, reason: 'track-credit-without-title-match' })
      continue
    }
    if (creditedNonPerforming) {
      // Written-By / Producer / Arranged By / Remix: the artist's work,
      // someone else's recording. Held for the owner, never served.
      heldOn.push({ record, reason: 'non-performing-credit' })
      continue
    }
    uncredited.push({ record, reason: record.artists.some((a) => a.id === DISCOGS_VARIOUS_ID) ? 'attached-to-various-artists-record' : 'attached-to-record-without-credit' })
  }
  const channelId = youtube[videoId]?.channelId
  if (channelId && artistChannelIds.has(channelId)) anchors.push({ kind: 'channel', channelId })
  return { anchors, uncredited, heldOn }
}

/**
 * A "<Someone Else> - Topic" channel is YouTube's own statement of
 * whose recording this is. When that someone is not an alias of ours,
 * the evidence conflicts and the video is HELD, whatever the credit.
 */
function topicContradicts(videoId, aliases) {
  const channel = youtube[videoId]?.channelTitle ?? ''
  if (!/ - Topic$/.test(channel)) return false
  return !aliases.has(normalizeName(channel.replace(/ - Topic$/, '')))
}

function corroborationsFor(videoId, anchors, evidence, aliases) {
  const meta = youtube[videoId]
  if (!meta || meta.gone) return []
  const upload = titleVariants(meta.title ?? '', aliases)
  const legs = new Set()
  const mb = evidence.musicbrainz
  const mbTitles = mb?.mbid ? new Set([...(mb.releaseGroupTitles ?? []), ...(mb.trackTitles ?? [])].flatMap((t) => [...titleVariants(t, aliases)])) : null
  for (const anchor of anchors) {
    if (anchor.kind === 'channel') {
      const own = evidence.records.filter((r) => r.artists.length && r.artists.every((a) => a.id === Number(evidence.discogsId)))
      for (const record of own) if (variantsIntersect(upload, recordTitleVariants(record, aliases))) legs.add('title')
    } else {
      if (variantsIntersect(upload, anchor.titles)) legs.add('title')
      if (meta.durationSeconds && anchor.durations.some((d) => Math.abs(d - meta.durationSeconds) <= DURATION_TOLERANCE_S)) legs.add('duration')
    }
  }
  if (mbTitles && variantsIntersect(upload, mbTitles)) legs.add('mb-title')
  const channelKey = normalizeName(meta.channelTitle ?? '')
  if (channelKey && [...aliases].some((alias) => channelKey === `${alias}topic`)) legs.add('topic')
  // The uploader names the artist in a whole title segment. Counted as
  // its own leg so the owner can rule on whether it corroborates a
  // whole-credit anchor (it is the quarantine's own bar, made exact).
  if (anchors.some((a) => a.kind === 'whole') && titleNamesArtist(meta.title, aliases)) legs.add('name')
  return [...legs]
}

/** Legs that verify on their own; 'name' only if the owner rules so. */
const NAME_LEG_ACCEPTED = process.argv.includes('--accept-name-leg')
function decisiveLegs(legs) {
  return NAME_LEG_ACCEPTED ? legs : legs.filter((leg) => leg !== 'name')
}

function judgeVideo(videoId, evidence, aliases, artistChannelIds) {
  const meta = youtube[videoId]
  const { anchors, uncredited, heldOn } = anchorsFor(videoId, evidence, aliases, artistChannelIds)
  const legs = corroborationsFor(videoId, anchors, evidence, aliases)
  const anchorKinds = anchors.map((a) => a.kind)
  const playable = !!meta && !meta.gone && meta.privacyStatus === 'public' && meta.embeddable
  if (anchors.length && topicContradicts(videoId, aliases)) return { videoId, verdict: 'held', reason: 'topic-channel-names-another-artist', anchors: anchorKinds, legs, playable, title: meta?.title ?? null }
  if (anchors.length && decisiveLegs(legs).length) return { videoId, verdict: 'verified', anchors: anchorKinds, legs, playable, title: meta?.title ?? null, durationSeconds: meta?.durationSeconds ?? null }
  if (!anchors.length && uncredited.length && !heldOn.length) return { videoId, verdict: 'refuted', reason: uncredited[0].reason, record: `${uncredited[0].record.kind} ${uncredited[0].record.id} "${uncredited[0].record.title}" by ${uncredited[0].record.artists.map((a) => a.name).join(', ')}`, playable, title: meta?.title ?? null }
  if (anchors.length) return { videoId, verdict: 'held', reason: `${anchorKinds[0]}-credit-without-corroboration`, anchors: anchorKinds, legs, playable, title: meta?.title ?? null }
  if (heldOn.length) return { videoId, verdict: 'held', reason: heldOn[0].reason, playable, title: meta?.title ?? null }
  return { videoId, verdict: 'held', reason: meta?.gone ? 'video-gone' : 'not-located-on-fetched-records', playable, title: meta?.title ?? null }
}

function judgeArtist(evidence) {
  const aliases = aliasKeys({ name: evidence.name ?? '', aliases: evidence.datasetAliases }, evidence.profile, evidence.musicbrainz?.name)
  const artistChannelIds = new Set([
    ...channelIdsFromUrls(evidence.profile?.urls),
    ...(evidence.musicbrainz?.channelIds ?? []),
  ])
  const stored = judgeVideo(evidence.storedVideoId, evidence, aliases, artistChannelIds)
  const others = evidence.candidateVideoIds
    .filter((id) => id !== evidence.storedVideoId)
    .map((id) => judgeVideo(id, evidence, aliases, artistChannelIds))
  const rank = (v) => Math.min(...v.anchors.map((a) => ANCHOR_RANK[a] ?? 9)) * 10 - v.legs.length
  const replacement = others
    .filter((v) => v.verdict === 'verified' && v.playable && (v.durationSeconds ?? 0) >= MIN_SONG_SECONDS)
    .sort((a, b) => rank(a) - rank(b))[0] ?? null
  const verdict = stored.verdict === 'verified' ? 'verified' : replacement ? 'replaced' : stored.verdict === 'refuted' ? 'refuted' : 'held'
  return {
    key: evidence.key,
    name: evidence.name,
    countries: evidence.countries,
    bucket: evidence.bucket,
    verdict,
    stored,
    replacement,
    candidatesJudged: others.length,
    creditedRecords: evidence.records.filter((r) => r.artists.every((a) => a.id === Number(evidence.discogsId)) || r.tracklist.some((t) => t.artists.includes(Number(evidence.discogsId)))).length,
    crosswalk: evidence.musicbrainz?.mbid ? 'mb' : evidence.musicbrainz?.ambiguous ? 'ambiguous' : null,
  }
}

function tally(rows, by) {
  const out = {}
  for (const row of rows) {
    const k = by(row)
    out[k] = (out[k] ?? 0) + 1
  }
  return out
}

function main() {
  const files = readdirSync(EVIDENCE_DIR).filter((f) => f.endsWith('.json') && f !== 'youtube.json')
  const rows = files.map((f) => judgeArtist(JSON.parse(readFileSync(join(EVIDENCE_DIR, f), 'utf8'))))
  const buckets = ['quarantined', 'kept']
  const summary = {}
  for (const bucket of buckets) {
    const sub = rows.filter((r) => r.bucket === bucket)
    summary[bucket] = {
      artists: sub.length,
      verdicts: tally(sub, (r) => r.verdict),
      storedVideo: tally(sub, (r) => r.stored.verdict + (r.stored.reason ? `:${r.stored.reason}` : '')),
      verifiedLegs: tally(sub.filter((r) => r.verdict === 'verified'), (r) => `${r.stored.anchors.join('+')}|${r.stored.legs.join('+')}`),
      replacedLegs: tally(sub.filter((r) => r.verdict === 'replaced'), (r) => `${r.replacement.anchors.join('+')}|${r.replacement.legs.join('+')}`),
      /** Classes the owner may want to rule on separately. */
      servingAnchor: tally(sub.filter((r) => r.verdict === 'verified' || r.verdict === 'replaced'), (r) => (r.verdict === 'verified' ? r.stored : r.replacement).anchors.sort((a, b) => (ANCHOR_RANK[a] ?? 9) - (ANCHOR_RANK[b] ?? 9))[0]),
      durationOnly: sub.filter((r) => (r.verdict === 'verified' && r.stored.legs.join() === 'duration') || (r.verdict === 'replaced' && r.replacement.legs.join() === 'duration')).length,
      /** Held links a whole credit + exact name-in-title would verify (owner ruling d). */
      rescuableByNameLeg: sub.filter((r) => r.verdict === 'held' && r.stored.anchors?.[0] === 'whole' && (r.stored.legs ?? []).includes('name')).length,
    }
  }
  const report = {
    generatedAt: new Date().toISOString().slice(0, 10),
    method: 'Anchor (whole-record credit / track credit + title / linked channel id) + corroboration (title / duration ±3s / MB title / Topic channel), exact whole-unit equality only. Report only; dataset untouched.',
    artists: rows.length,
    summary,
    rows: rows.sort((a, b) => a.key.localeCompare(b.key)),
  }
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 1))
  console.log(JSON.stringify(summary, null, 1))
  if (VERBOSE) {
    for (const r of rows) {
      const stored = `${r.stored.verdict}${r.stored.reason ? ` (${r.stored.reason})` : ''}${r.stored.legs?.length ? ` [${r.stored.anchors.join('+')} | ${r.stored.legs.join('+')}]` : ''}`
      const repl = r.replacement ? ` → ${r.replacement.videoId} "${(r.replacement.title ?? '').slice(0, 50)}" [${r.replacement.anchors.join('+')} | ${r.replacement.legs.join('+')}]` : ''
      console.log(`${r.bucket[0].toUpperCase()} ${r.verdict.padEnd(8)} ${r.key} ${stripDiscogsDisambiguator(r.name ?? '')} (${r.countries.join(',')}) · stored "${(r.stored.title ?? '').slice(0, 45)}" ${stored}${repl}`)
    }
  }
  console.log(`report → ${REPORT_PATH}`)
}

main()
