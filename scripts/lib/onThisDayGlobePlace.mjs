/**
 * The fallback place for an "On this day" song with no verified
 * recording place (owner, Oct 11 2026): the country where the artist's
 * music happened, by the SAME rule the globe places artists with, and
 * nothing when the artist is on the globe in more than one place with no
 * dated way to tell which applies to the song's year.
 *
 * `placements`: every place the globe puts this artist, each with the
 * dated span the globe era-gates it by ({ place, from, to }; null = not
 * dated). Pure.
 */
export function globePlace(placements, year) {
  const places = new Set(placements.map((entry) => entry.place))
  if (places.size === 0) return null
  if (places.size === 1) return [...places][0]
  // Several places: only a dated span can choose, and an undated place
  // can never be ruled out — so every placement must be dated.
  if (placements.some((entry) => entry.from == null && entry.to == null)) return null
  const covering = new Set(
    placements
      .filter((entry) => (entry.from == null || entry.from <= year) && (entry.to == null || entry.to >= year))
      .map((entry) => entry.place),
  )
  return covering.size === 1 ? [...covering][0] : null
}
