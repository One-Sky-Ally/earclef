/**
 * Stable identity for a feed item, shared by the client (requesting
 * blurbs) and the server (caching them). Pure — safe in both bundles.
 */

/**
 * "OK Computer (Deluxe Edition)" and "OK Computer" are the same drop, as are
 * "X (feat. Y) / Z" and "X / Z" — edition tags and feature credits vary by
 * source, so both are stripped from the key.
 */
export function normalizedTitle(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[([](feat|ft|with|deluxe|expanded|remaster(ed)?|special)[^)\]]*[)\]]/g, '')
    .replace(/[^a-z0-9]+/g, '')
}

export type FeedItemType = 'release' | 'video'

/**
 * Blob key: one blurb per item, ever — the whole cost model hangs on
 * this. The version prefix orphans every older generation when the
 * prompt or trimming rules change materially (v2: sentence-safe trim +
 * stricter certainty rule after a hallucinated-producer incident).
 */
export function blurbKey(
  slug: string,
  type: FeedItemType,
  title: string,
): string {
  return `v2/${slug}/${type}/${normalizedTitle(title) || 'untitled'}`
}
