/** Shared outbound-link builders — YouTube-first listening, keyless artwork. */

export function youtubeSearchUrl(query: string): string {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`
}

export function youtubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`
}

export function youtubeThumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`
}

/** Cover Art Archive front cover, 250px — keyless, hotlink-friendly. */
export function coverArtUrl(releaseGroupId: string): string {
  return `https://coverartarchive.org/release-group/${releaseGroupId}/front-250`
}

/** 500px variant for featured feed cards — same source, bigger render. */
export function coverArtUrlLarge(releaseGroupId: string): string {
  return `https://coverartarchive.org/release-group/${releaseGroupId}/front-500`
}

/**
 * Highest-quality YouTube thumbnail. maxresdefault 404s on some videos —
 * callers fall back (maxres → mqdefault → placeholder) via onError.
 */
export function youtubeThumbnailLargeUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`
}

/** Quoted phrases keep YouTube on-target (the band, not the movie). */
export function quotedSearch(artist: string, title: string): string {
  return youtubeSearchUrl(`"${artist}" "${title}"`)
}

/** Edition tags vary by source and rarely appear in YouTube upload titles. */
export function stripEditionTags(title: string): string {
  return title
    .replace(
      /[([](feat|ft|with|deluxe|expanded|remaster(ed)?|special|anniversary|edition|bonus)[^)\]]*[)\]]/gi,
      '',
    )
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/**
 * Listen search tuned for findability: the title stays quoted (precision),
 * the artist goes unquoted so name variants — "&" vs "and", missing
 * diacritics, dropped "The" — can't zero out the results. Very short or
 * one-word titles keep the artist quoted too, as the title alone would
 * drift off-target ("Blue", "IV").
 */
export function listenSearch(artist: string, title: string): string {
  const cleaned = stripEditionTags(title) || title
  const generic =
    cleaned.length <= 4 || (!cleaned.includes(' ') && cleaned.length <= 6)
  return generic
    ? quotedSearch(artist, cleaned)
    : youtubeSearchUrl(`"${cleaned}" ${artist}`)
}

/** Bandcamp album search — keyless, for artists whose catalog lives there. */
export function bandcampSearchUrl(artist: string, title: string): string {
  const query = encodeURIComponent(`${artist} ${stripEditionTags(title) || title}`)
  return `https://bandcamp.com/search?q=${query}&item_type=a`
}

/** Internet Archive audio search — where pre-1950 releases (78s) survive. */
export function archiveAudioSearchUrl(artist: string, title: string): string {
  const query = encodeURIComponent(`${artist} ${stripEditionTags(title) || title}`)
  return `https://archive.org/search?query=${query}&and%5B%5D=mediatype%3A%22audio%22`
}
