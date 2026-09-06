/**
 * THE comparison key for artist names, shared by dedup rule v3 and the
 * local MusicBrainz name index. Case/accent/punctuation-insensitive
 * and script-aware: a Cyrillic or Thai name keeps its letters (v1's
 * Latin-only filter reduced them to '' — and per standing lesson 5,
 * empty must never be able to match).
 *
 * Lives in its own module so the index builder and its reader can
 * share it with the rule without an import cycle.
 */
export function normalizeName(value) {
  return (value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}
