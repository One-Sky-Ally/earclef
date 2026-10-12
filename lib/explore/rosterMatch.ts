/**
 * The Ear Clef roster is checked FIRST on every explore search (owner
 * ruling, Oct 12 2026: searching "Trust in the Sun" opened a
 * MusicBrainz artist called "Suntrust" instead of the band's own page).
 * The route passes the rows from lib/discover/roster.json, the snapshot
 * rebuilt before every build so a serverless route never reads content/.
 *
 * Exact (normalized) name = certain: the artist's page opens. Anything
 * looser is a CHOICE the visitor makes, never a silent pick.
 */

export interface RosterRow {
  slug: string
  name: string
  identity?: string
}

export interface RosterMatch {
  slug: string
  name: string
  /** The artist's one-line identity — shown under a choice. */
  identity?: string
}

export function normalizedName(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** "the beatles" and "beatles" are the same ask. */
function withoutArticle(value: string): string {
  return value.replace(/^the /, '')
}

function toMatch(row: RosterRow): RosterMatch {
  return {
    slug: row.slug,
    name: row.name,
    ...(row.identity ? { identity: row.identity } : {}),
  }
}

/** The roster artist whose name IS the query, or null. */
export function rosterExact(rows: RosterRow[], query: string): RosterMatch | null {
  const wanted = withoutArticle(normalizedName(query))
  if (!wanted) return null
  const row = rows.find(
    (candidate) => withoutArticle(normalizedName(candidate.name)) === wanted,
  )
  return row ? toMatch(row) : null
}

/** Shortest query a partial match may hinge on — "sun" alone is noise. */
const MIN_PARTIAL = 4
const MAX_PARTIAL = 5

/**
 * Roster artists the query plausibly means but does not name exactly:
 * the query inside the name ("trust in the" → Trust in the Sun), the
 * name inside the query ("the band cake" → Cake), or every word of a
 * multi-word query somewhere in the name ("sun trust" → Trust in the
 * Sun). Offered as choices, never opened on their own.
 */
export function rosterPartial(rows: RosterRow[], query: string): RosterMatch[] {
  const wanted = withoutArticle(normalizedName(query))
  if (wanted.length < MIN_PARTIAL) return []
  const words = wanted.split(' ').filter((word) => word.length >= 2)
  const exact = rosterExact(rows, query)
  return rows
    .filter((row) => {
      if (exact && row.slug === exact.slug) return false
      const name = withoutArticle(normalizedName(row.name))
      if (name.length < MIN_PARTIAL) return false
      if (name.includes(wanted) || wanted.includes(name)) return true
      if (words.length < 2) return false
      const nameWords = new Set(name.split(' '))
      return words.every((word) => nameWords.has(word))
    })
    .slice(0, MAX_PARTIAL)
    .map(toMatch)
}
