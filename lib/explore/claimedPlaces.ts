/**
 * Claimed places (owner-approved principle, Aug 27–28 2026): a place
 * artists claim as identity exists on the globe. THE RULES, all
 * owner-ruled: NAME-NEVER-DRAW (a named anchor, no polygon — a border
 * is a claim, a name is the artist's claim quoted); label appears on
 * SEARCH AND SELECT ONLY, never on the idle globe; the roster bar is
 * SELF-IDENTIFICATION ONLY; every claimed place carries the contested
 * asterisk and the shared policy note; no heat, no counts.
 *
 * Display names are the artists' names for the place — Tibet, not
 * Xizang — while search aliases accept both directions in good faith.
 *
 * Client-safe: a tiny static registry, no dataset imports. Rosters
 * live server-side under lib/explore/claimed-places/.
 */
export interface ClaimedPlace {
  id: string
  name: string
  /** Search aliases, lowercased — both endonyms and exonyms match. */
  aliases: string[]
  /** Fly-to anchor (owner-ruled per entry). Never a polygon. */
  anchor: { lat: number; lng: number }
}

/** The claimed-place panel line, owner-approved verbatim. */
export const CLAIMED_PLACE_LINE =
  'This place is here because its musicians say it is.'

export const CLAIMED_PLACES: ClaimedPlace[] = [
  {
    id: 'tibet',
    name: 'Tibet',
    aliases: ['tibet', 'བོད', 'bod', 'xizang', '西藏'],
    // Lhasa (owner-ruled anchor, Aug 28).
    anchor: { lat: 29.65, lng: 91.1 },
  },
]

export function claimedPlaceById(code: string): ClaimedPlace | undefined {
  return CLAIMED_PLACES.find((place) => place.id === code)
}

export function claimedPlaceByQuery(query: string): ClaimedPlace | undefined {
  const q = query.trim().toLowerCase()
  return CLAIMED_PLACES.find(
    (place) => place.name.toLowerCase() === q || place.aliases.includes(q),
  )
}
