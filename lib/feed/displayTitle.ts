/**
 * The headline a feed card shows for an upload title. Channel titles
 * carry raw hashtags ("Orange Juice #shorts #vegasmusic") — tags are
 * metadata, not a headline, so they are dropped for display only. The
 * stored title is untouched: blurb keys and dedupe still read it.
 * "#1" stays — a chart position is part of the title, not a tag.
 */
const HASHTAG = /(^|\s)#[\p{L}_][\p{L}\p{N}_]*/gu
const EDGE_SEPARATORS = /^[\s|\-–—·:,]+|[\s|\-–—·:,]+$/g

export function displayTitle(title: string): string {
  const stripped = title
    .replace(HASHTAG, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(EDGE_SEPARATORS, '')
    .trim()
  return stripped || title
}
