/**
 * Exact-variant title matching for runtime play resolution — the
 * TypeScript port of the gap-fill identity helpers in
 * scripts/lib/extraPlayIdentity.mjs (kept byte-for-byte in rule, so a
 * change here must be mirrored there and vice versa).
 *
 * Every comparison is EXACT normalized equality over whole units —
 * whole titles, whole title segments, whole aliases. No containment,
 * no similarity (verified-play policy: fuzzy matching is banned as
 * verification). Coverage widens only by enumerating VARIANTS of a
 * title (script sides of "A = B", sides of "A / B", decoration-stripped
 * forms, quoted spans) and comparing each variant exactly.
 *
 * Relative imports only: bundled into the Netlify background function.
 */

/** Script-aware, exact: the same normalization as lib/play/resolve.ts. */
export function normalizeName(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

/**
 * Bracketed asides, ASCII and full-width: "(Official Video)",
 * "【MV】", "（Live）", "［Remastered］" — Japanese uploads use the
 * full-width forms as often as the ASCII ones.
 */
const TRAILING_GROUP = /\s*[([{（［【〔][^()[\]{}（）［］【】〔〕]*[)\]}）］】〕]\s*$/
const ANY_GROUP = /\s*[([{（［【〔][^()[\]{}（）［］【】〔〕]*[)\]}）］】〕]\s*/g
const LEADING_TRACK_NUMBER = /^\s*(?:[a-z]?\d{1,2}[.)\-:]?|\d{1,2}\s*[.)\-])\s+/i
const TRAILING_FEAT = /\s+(?:feat\.?|ft\.?|featuring|avec|con)\s+.+$/i
/**
 * Whole-span separators: a dash/bar/tilde/colon with whitespace on at
 * least one side (so "Jean-Pierre" and "Da-LiGs" never split), or a run
 * of two or more spaces — uploaders often type "Artist   Title".
 */
const SEGMENT_SPLIT = /\s+[-–—|·:~]\s*|\s*[-–—|·~]\s+|\s{2,}/
/**
 * Quoted titles: double quotes and guillemets, Japanese 「」『』 and
 * 〈〉《》, and single quotes ‘…’ / '…' — the single ones only as whole
 * quotes (never an apostrophe inside a word, as in "Don't") and two
 * characters or more, so "Rock 'n' Roll" yields no one-letter title.
 */
const QUOTED_SPAN = /["“«„「『〈《]([^"”»“」』〉》]+)["”»」』〉》]/g
const SINGLE_QUOTED_SPAN = /(?<![\p{L}\p{N}])['‘]([^'‘’]{2,})['’](?![\p{L}\p{N}])/gu

/** Discogs names carry "(2)" disambiguators — never part of the name. */
export function stripDiscogsDisambiguator(name: string): string {
  return name.replace(/\s*\(\d+\)\s*$/, '')
}

/** Normalized alias keys for a name set (empty keys dropped). */
export function aliasKeysOf(names: readonly (string | null | undefined)[]): Set<string> {
  return new Set(
    names
      .map((name) => normalizeName(stripDiscogsDisambiguator(name ?? '')))
      .filter((key) => key !== ''),
  )
}

/** Every decoration-stripped form of a title span, recursively. */
function expandForms(title: string): string[] {
  const forms = new Set<string>()
  const ordered: string[] = []
  const expand = (value: string): void => {
    const trimmed = value.trim()
    if (!trimmed || forms.has(trimmed)) return
    forms.add(trimmed)
    ordered.push(trimmed)
    const noGroups = trimmed.replace(TRAILING_GROUP, '')
    if (noGroups !== trimmed) expand(noGroups)
    const noAnyGroup = trimmed.replace(ANY_GROUP, ' ')
    if (noAnyGroup !== trimmed) expand(noAnyGroup)
    const noNumber = trimmed.replace(LEADING_TRACK_NUMBER, '')
    if (noNumber !== trimmed) expand(noNumber)
    const noFeat = trimmed.replace(TRAILING_FEAT, '')
    if (noFeat !== trimmed) expand(noFeat)
    for (const side of trimmed.split(/\s+=\s+/)) if (side !== trimmed) expand(side)
    for (const side of trimmed.split(/\s*\/\s*/)) if (side !== trimmed) expand(side)
    for (const quoted of trimmed.matchAll(QUOTED_SPAN)) expand(quoted[1])
    for (const quoted of trimmed.matchAll(SINGLE_QUOTED_SPAN)) expand(quoted[1])
    const segments = trimmed.split(SEGMENT_SPLIT).filter(Boolean)
    if (segments.length > 1) {
      for (const segment of segments) expand(segment)
    }
  }
  expand(title)
  return ordered
}

/**
 * Every whole-unit variant of a title, normalized. Used on BOTH sides
 * (upload titles and catalog titles) so "Artist - Song (Official
 * Video)" meets "Song" as a whole segment, never as a substring.
 * Segments that are the artist's own name are dropped; an alias at the
 * very start or end of a variant leaves the REST as a whole unit; an
 * alias alone is a NAME, never a title.
 */
export function titleVariants(
  title: string | null | undefined,
  aliases: ReadonlySet<string> = new Set(),
): Set<string> {
  const keys = expandForms(title ?? '')
    .map(normalizeName)
    .filter((key) => key !== '' && !aliases.has(key))
  const withEdges = keys.flatMap((key) =>
    [...aliases].flatMap((alias) => {
      if (key.length <= alias.length) return []
      return [
        ...(key.startsWith(alias) ? [key.slice(alias.length)] : []),
        ...(key.endsWith(alias) ? [key.slice(0, key.length - alias.length)] : []),
      ]
    }),
  )
  return new Set([...keys, ...withEdges].filter((key) => key !== '' && !aliases.has(key)))
}

/** Does any variant of `a` equal any variant of `b`? Exact keys only. */
export function variantsIntersect(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  for (const key of a) if (b.has(key)) return true
  return false
}

/** "3:44" / "1:02:10" → seconds; '' → null (missing is never a match). */
export function colonDurationSeconds(value: string | null | undefined): number | null {
  if (!value || typeof value !== 'string') return null
  const parts = value.trim().split(':').map(Number)
  if (parts.some((part) => !Number.isFinite(part))) return null
  return parts.reduce((total, part) => total * 60 + part, 0) || null
}
