/** Client-side types + fetchers for the catalog and videos popups. */

export interface CatalogItem {
  rgid: string
  title: string
  year?: string
  /** Full first-release date when MusicBrainz has it (YYYY[-MM[-DD]]). */
  date?: string
}

export interface BrowserCategory<T> {
  key: string
  label: string
  items: T[]
}

export interface CatalogResponse {
  categories: BrowserCategory<CatalogItem>[]
}

export interface VideoItem {
  videoId: string
  title: string
  publishedAt?: string
}

export interface VideosResponse {
  source: 'api' | 'rss'
  partial: boolean
  categories: BrowserCategory<VideoItem>[]
}

export interface AlbumDetails {
  tracks: string[]
}

export interface SpotifyRelease {
  title: string
  date: string
  image?: string
}

export interface SpotifyReleasesResponse {
  items: SpotifyRelease[]
}

async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export function fetchCatalog(
  mbid: string,
  signal: AbortSignal,
): Promise<CatalogResponse> {
  return getJson(`/api/artist/catalog/${mbid}`, signal)
}

export function fetchVideos(
  channelId: string,
  signal: AbortSignal,
): Promise<VideosResponse> {
  return getJson(`/api/artist/videos/${channelId}`, signal)
}

export function fetchAlbumDetails(
  rgid: string,
  signal: AbortSignal,
): Promise<AlbumDetails> {
  return getJson(`/api/artist/album/${rgid}`, signal)
}

export function fetchSpotifyReleases(
  spotifyId: string,
  signal: AbortSignal,
): Promise<SpotifyReleasesResponse> {
  return getJson(`/api/artist/releases/${spotifyId}`, signal)
}
