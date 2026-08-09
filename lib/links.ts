/**
 * Shared outbound-link builders — keyless artwork, verified watch URLs.
 * YouTube SEARCH builders were removed under the Aug 8, 2026 ruling: a
 * YouTube miss lands on unrelated video content. Verified video IDs
 * come from lib/play; release-level searches go to music services
 * (lib/listen/services) with honest "Search on X" labels.
 */

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

/** Edition tags vary by source and rarely appear in upload titles. */
export function stripEditionTags(title: string): string {
  return title
    .replace(
      /[([](feat|ft|with|deluxe|expanded|remaster(ed)?|special|anniversary|edition|bonus)[^)\]]*[)\]]/gi,
      '',
    )
    .replace(/\s{2,}/g, ' ')
    .trim()
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
