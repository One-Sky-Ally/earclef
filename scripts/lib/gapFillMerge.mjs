/**
 * Top-up merge of a sweep's fresh result into a country's committed
 * gap-fill list — moved verbatim from build-extra-artists.mjs (Sep
 * 2026) so it can be tested, plus the no-removal guard the sweep runs
 * before it writes anything.
 */
import { normalizeName as normalize } from './normalizeName.mjs'

const minYear = (a, b) => (a === null ? b : b === null ? a : Math.min(a, b))
const maxYear = (a, b) => (a === null ? b : b === null ? a : Math.max(a, b))

/** Dataset order: documented years first, then the most-pressed. */
export function byDatedThenPressed(a, b) {
  return (
    (a.firstYear === null ? 1 : 0) - (b.firstYear === null ? 1 : 0) ||
    b.releaseCount - a.releaseCount ||
    a.name.localeCompare(b.name)
  )
}

/**
 * TOP-UP SEMANTICS (owner go, Sep 6, 2026). The committed list is the
 * owner's state: presence rulings, notes, attested aliases, drift
 * retention and reinstatements were all written ONTO entries by later
 * passes, so an entry is never rebuilt — only its era and press count
 * may widen from releases the sweep had never seen. A fresh artist is
 * appended when neither its Discogs id nor its name/aliases match an
 * existing entry; a name-only clash with an existing entry is skipped
 * and reported (same-name-different-id is an identity call, not a
 * merge). Returns a NEW list, never mutates the committed one.
 */
export function mergeIntoCommitted(current, fresh) {
  const byId = new Map()
  const byWikidata = new Map()
  const byName = new Map()
  const idless = new Map()
  current.forEach((artist, index) => {
    if (artist.discogsArtistId != null) byId.set(String(artist.discogsArtistId), index)
    if (artist.wikidataId) byWikidata.set(artist.wikidataId, index)
    // An entry with neither id IS its name (the id-less class); a
    // same-name candidate that also has no id is the same entry.
    if (artist.discogsArtistId == null && !artist.wikidataId) {
      const key = normalize(artist.name)
      if (key && !idless.has(key)) idless.set(key, index)
    }
    for (const label of [artist.name, ...(artist.aliases ?? [])]) {
      const key = normalize(label)
      if (key && !byName.has(key)) byName.set(key, index)
    }
  })
  const list = [...current]
  let added = 0
  let widened = 0
  const nameClash = []
  const addedNames = []
  for (const artist of fresh) {
    const idKey = artist.discogsArtistId != null ? String(artist.discogsArtistId) : null
    const index =
      (idKey !== null ? byId.get(idKey) : undefined) ??
      (artist.wikidataId ? byWikidata.get(artist.wikidataId) : undefined) ??
      (idKey === null && !artist.wikidataId ? idless.get(normalize(artist.name)) : undefined)
    if (index !== undefined) {
      const committed = list[index]
      const next = {
        ...committed,
        firstYear: minYear(committed.firstYear, artist.firstYear),
        lastYear: maxYear(committed.lastYear, artist.lastYear),
        releaseCount: Math.max(committed.releaseCount, artist.releaseCount),
        ...(committed.styles.length === 0 && artist.styles.length > 0
          ? { styles: artist.styles }
          : {}),
        // Provenance the ingest now knows (historical-entity pressings,
        // owner fix-forward Aug 26): additive, display-neutral.
        ...(artist.pressedAs && !committed.pressedAs
          ? { pressedAs: artist.pressedAs }
          : {}),
      }
      if (
        next.firstYear !== committed.firstYear ||
        next.lastYear !== committed.lastYear ||
        next.releaseCount !== committed.releaseCount ||
        next.styles !== committed.styles ||
        next.pressedAs !== committed.pressedAs
      ) {
        list[index] = next
        widened++
      }
      continue
    }
    const clash = [artist.name, ...(artist.aliases ?? [])]
      .map(normalize)
      .find((key) => key && byName.has(key))
    if (clash) {
      nameClash.push(`${artist.name} ↔ ${list[byName.get(clash)].name}`)
      continue
    }
    list.push(artist)
    addedNames.push(artist.name)
    added++
    if (idKey !== null) byId.set(idKey, list.length - 1)
    for (const label of [artist.name, ...(artist.aliases ?? [])]) {
      const key = normalize(label)
      if (key && !byName.has(key)) byName.set(key, list.length - 1)
    }
  }
  return { list: list.sort(byDatedThenPressed), added, widened, nameClash, addedNames }
}

const identityOf = (artist) =>
  `${artist.discogsArtistId ?? ''}|${artist.wikidataId ?? ''}|${artist.name}`

/**
 * STANDING RULE: nobody already in the pool is removed. Every committed
 * entry must still be in the list about to be written (matched on its
 * Discogs id, Wikidata id and name — the fields a merge never
 * rewrites). Throws with the missing entries instead of writing.
 */
export function assertNothingRemoved(code, before, after) {
  const remaining = new Map()
  for (const artist of after) {
    const key = identityOf(artist)
    remaining.set(key, (remaining.get(key) ?? 0) + 1)
  }
  const missing = []
  for (const artist of before) {
    const key = identityOf(artist)
    const left = remaining.get(key) ?? 0
    if (left === 0) missing.push(artist.name)
    else remaining.set(key, left - 1)
  }
  if (missing.length > 0) {
    throw new Error(
      `${code}: ${missing.length} committed artist(s) would be removed (${missing.slice(0, 5).join(', ')}) — nothing written`,
    )
  }
}
