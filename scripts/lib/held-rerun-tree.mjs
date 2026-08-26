/**
 * Decision tree v2 for the held-ruling re-run.
 *
 * Same ruling as Aug 11 — the discriminator is ORIGIN, never area and
 * never fame — with one change: the IDENTITY leg is now evidence, not
 * inference. The old tree used "distinctive name + corroboration" as a
 * proxy for "this entry is that MB artist". The crosswalk measured that
 * proxy wrong ~27% of the time, so v2 ranks identity by how it was
 * established and never lets a name-only identity carry an exclusion.
 *
 *   id-proven    — a Discogs-page URL links the two, in either direction
 *   id-disproven — the MB artist links to a DIFFERENT Discogs page, or
 *                  our page links to a different MB artist
 *   name-only    — the Aug-11 leg, unsupported by any id
 *
 * Absent is never a match (lesson 5): an MB artist with no Discogs
 * relation proves nothing in either direction and stays the owner's.
 */

const originQidOf = (wd) => wd?.origin ?? wd?.formed ?? wd?.born ?? null

/** Origin rule, unchanged. Returns 'in-pool' | 'foreign' | null. */
function originVerdict(evidence, pool) {
  const wd = evidence?.wd ?? null
  const originQid = originQidOf(wd)
  if (wd?.citizenships?.includes(pool.qid) || originQid === pool.qid) return 'in-pool'
  if (originQid) return 'foreign'
  const beginCountry = evidence?.beginCountry ?? null
  if (beginCountry) return beginCountry === pool.mbArea ? 'in-pool' : 'foreign'
  return null
}

function originNote(evidence, pool) {
  const wd = evidence?.wd ?? null
  const originQid = originQidOf(wd)
  if (wd?.citizenships?.includes(pool.qid)) return `wd citizenship ${pool.qid} = pool`
  if (originQid === pool.qid) return `wd origin ${pool.qid} = pool`
  if (originQid) return `wd origin ${originQid} ≠ pool${wd?.description ? ` ("${wd.description}")` : ''}`
  if (evidence?.beginCountry) return `MB begin-area resolves to ${evidence.beginCountry}`
  return 'no origin signal'
}

/**
 * One case → one outcome. `reverse` is the case MBID's own evidence,
 * `originOf` looks up gathered evidence for a crosswalk MBID.
 */
export function decide(kase, reverse, originOf, pool) {
  const crossLocal = kase.crosswalk.find((leak) => leak.mbAreaCountry === kase.cc)
  const crossOther = kase.crosswalk.filter((leak) => leak.mbid !== kase.mbid)
  const crossSame = kase.crosswalk.find((leak) => leak.mbid === kase.mbid)
  const linkedIds = reverse?.missing === false ? (reverse.discogsIds ?? []) : []
  const reverseHasOurs = linkedIds.includes(String(kase.discogsId))
  const reverseElsewhere = linkedIds.length > 0 && !reverseHasOurs

  const evidenceTrail = {
    crosswalk: kase.crosswalk.map((leak) => ({
      mbid: leak.mbid, mbName: leak.mbName, area: leak.mbArea,
      areaCountry: leak.mbAreaCountry, class: leak.class,
      sameAsCase: leak.mbid === kase.mbid,
    })),
    caseMbidLinksTo: linkedIds,
    caseMbidRelCount: reverse?.relCount ?? null,
    caseMbidOrigin: reverse?.missing === false ? originNote(reverse, pool) : null,
  }

  // Owner-reserved history classes: evidence attached, never acted on.
  if (kase.reserved) {
    return { outcome: 'owner', identity: 'reserved', why: 'owner-reserved history class — partition/occupation/exile or pinned area', evidenceTrail }
  }

  // 1. Our Discogs page is ID-linked to an MB artist filed IN the pool.
  if (crossLocal) {
    return {
      outcome: 'keep', identity: 'id-proven-local',
      why: `MB links this Discogs page to ${crossLocal.mbName} (${crossLocal.mbArea}) — a pool-country artist; the Aug-11 name match to ${kase.mbName} (${kase.mbArea}) was a homonym`,
      evidenceTrail,
    }
  }

  // 2. The name-matched MB artist is a DIFFERENT Discogs page.
  if (reverseElsewhere) {
    return {
      outcome: 'keep', identity: 'id-disproven',
      why: `MB's ${reverse.mbName} links to discogs/${linkedIds.join(', discogs/')} — not our page ${kase.discogsId}; the collision is disproven at id level`,
      evidenceTrail,
    }
  }

  // 3. Our page is ID-linked to a DIFFERENT MB artist: identity proven,
  //    origin taken from that artist (never from its area field).
  if (crossOther.length) {
    const leak = crossOther[0]
    const evidence = originOf(leak.mbid)
    const verdict = originVerdict(evidence, pool)
    if (verdict === 'in-pool') {
      return { outcome: 'keep-note', identity: 'id-proven-other', why: `id-linked to ${leak.mbName}; ${originNote(evidence, pool)} — residence-not-origin`, evidenceTrail }
    }
    if (verdict === 'foreign') {
      return { outcome: 'propose-exclude', identity: 'id-proven-other', why: `id-linked to ${leak.mbName}; ${originNote(evidence, pool)}`, evidenceTrail }
    }
    return { outcome: 'owner', identity: 'id-proven-other', why: `identity settled at id level (${leak.mbName}, MB area ${leak.mbArea ?? 'none'}) but NO origin signal — area is residence, not origin`, evidenceTrail }
  }

  // 4. Identity confirmed on the case's own MBID (either direction).
  if (crossSame || reverseHasOurs) {
    const verdict = originVerdict(reverse, pool)
    if (verdict === 'in-pool') {
      return { outcome: 'keep-note', identity: 'id-confirmed', why: `identity confirmed by Discogs-page id; ${originNote(reverse, pool)} — residence-not-origin`, evidenceTrail }
    }
    if (verdict === 'foreign') {
      return { outcome: 'propose-exclude', identity: 'id-confirmed', why: `identity confirmed by Discogs-page id; ${originNote(reverse, pool)}`, evidenceTrail }
    }
    return { outcome: 'owner', identity: 'id-confirmed', why: `identity certain (two independent legs) but no origin signal — MB area ${kase.mbArea} is residence, not origin`, evidenceTrail }
  }

  // 5. No id evidence in either direction — the Aug-11 leg stands alone.
  // PRE-DATES-FORMATION GUARD (Aug-11 rule, dropped in v2, restored
  // Aug 26 after the owner caught B1/B8 leaking through): a pressing
  // that pre-dates the matched artist's formation is IMPOSSIBLE
  // identity — era disproves a name-only collision outright. Direction
  // matters: entry AFTER the life end is a posthumous reissue and
  // stays compatible with identity. The guard lives on this branch
  // ONLY — an id-proven link outranks era (a conflicting year there
  // means noisy data, not a different artist).
  const firstYear = kase.entryYears?.[0] ?? null
  const lifeBegin = reverse?.life?.begin
    ? Number(String(reverse.life.begin).slice(0, 4)) || null
    : null
  if (firstYear !== null && lifeBegin !== null && firstYear < lifeBegin) {
    return {
      outcome: 'keep', identity: 'era-disproven',
      why: `entry ${firstYear} pre-dates the matched artist's ${lifeBegin} formation — impossible identity (Sweet Exorcist class)`,
      evidenceTrail,
    }
  }
  const verdict = originVerdict(reverse, pool)
  if (verdict === 'in-pool') {
    return { outcome: 'keep-note', identity: 'name-only', why: `${originNote(reverse, pool)} — origin points into the pool`, evidenceTrail }
  }
  if (verdict === 'foreign') {
    return { outcome: 'propose-exclude', identity: 'name-only', why: `${originNote(reverse, pool)}; identity is NAME-ONLY (the leg this pass measured ~27% wrong) — owner confirmation required`, evidenceTrail }
  }
  return { outcome: 'owner', identity: 'name-only', why: 'no id evidence in either direction and no origin signal — nothing the data can settle', evidenceTrail }
}

/** Mirror-check classification for an applied exclusion. */
export function classifyMirror(row, matches, pool) {
  if (!matches.length) {
    return { verdict: 'no-mb-link', why: 'MB links nothing to this Discogs page — the exclusion rests on the Aug-11 name match alone' }
  }
  const local = matches.find((match) => match.areaCountry === row.cc)
  if (local) {
    return {
      verdict: 'WRONG-EXCLUSION-CANDIDATE',
      why: `MB links this Discogs page to ${local.name}, filed in ${local.areaName} (${local.areaCountry}) — the pool's own country. The excluded entry looks like a real local act.`,
      match: local,
    }
  }
  const same = matches.find((match) => match.mbid === row.recordedMbid)
  if (same) {
    const origin = originVerdict(same, pool)
    return {
      verdict: origin === 'in-pool' ? 'WRONG-EXCLUSION-CANDIDATE' : 'confirmed',
      why: origin === 'in-pool'
        ? `identity confirmed, but ${originNote(same, pool)} — origin points INTO the pool`
        : `identity confirmed at id level (${same.name}); ${originNote(same, pool)}`,
      match: same,
    }
  }
  const other = matches[0]
  const origin = originVerdict(other, pool)
  return {
    verdict: origin === 'in-pool' ? 'WRONG-EXCLUSION-CANDIDATE' : 'different-identity',
    why: `MB links this page to ${other.name} (${other.areaName ?? 'no area'}), NOT the recorded ${row.name}; ${originNote(other, pool)}`,
    match: other,
  }
}

export { originVerdict, originNote }
