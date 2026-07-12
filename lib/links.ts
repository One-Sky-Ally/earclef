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

/** Quoted phrases keep YouTube on-target (the band, not the movie). */
export function quotedSearch(artist: string, title: string): string {
  return youtubeSearchUrl(`"${artist}" "${title}"`)
}
