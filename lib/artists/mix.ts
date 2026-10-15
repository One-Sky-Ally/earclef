/**
 * The Artists page's random mix: what visitors see instead of anyone's
 * favourites (owner ruling, Oct 14 2026). Pure helpers so the shuffle
 * and the split can be tested without a browser.
 */

/** Fisher–Yates: every order equally likely, the input left untouched. */
export function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

/** Rows at most; past this a row just scrolls further. */
export const MAX_MIX_ROWS = 4
/** Fewer cards than this and a row is not worth starting. */
export const MIN_ROW_CARDS = 12

/**
 * Splits a list into rows of near-equal length (they differ by at most
 * one), keeping the order: as many rows as the list fills, up to
 * MAX_MIX_ROWS.
 */
export function mixRows<T>(items: readonly T[]): T[][] {
  if (items.length === 0) return []
  const count = Math.min(
    MAX_MIX_ROWS,
    Math.max(1, Math.floor(items.length / MIN_ROW_CARDS)),
  )
  const rows: T[][] = []
  let start = 0
  for (let row = 0; row < count; row++) {
    const size = Math.floor(items.length / count) + (row < items.length % count ? 1 : 0)
    rows.push(items.slice(start, start + size))
    start += size
  }
  return rows
}
