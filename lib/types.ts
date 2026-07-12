export interface ImageRef {
  src: string
  alt: string
}

export type Platform =
  | 'spotify'
  | 'appleMusic'
  | 'bandcamp'
  | 'instagram'
  | 'youtube'
  | 'tiktok'
  | 'x'
  | 'facebook'
  | 'website'

export interface PlatformLink {
  platform: Platform | string
  url: string
}

export interface PageMeta {
  title: string
  description: string
  ogImage: string
  canonicalUrl: string
}

export interface Integrations {
  spotify: { artistId: string }
  youtube: { channelId: string }
  setlistfm: { mbid: string }
  itunes?: { artistId: string }
}

export interface HeroContent {
  name: string
  identity: string
  tagline?: string
  location: string
  image: ImageRef
  socials: PlatformLink[]
}

export interface FeaturedAlbum {
  title: string
  year?: string
  /** MusicBrainz release-group id — powers artwork and tracklists. */
  mbReleaseGroupId?: string
}

export interface ListenContent {
  enabled: boolean
  platforms: PlatformLink[]
  featuredAlbums: FeaturedAlbum[]
}

export interface VideoRef {
  youtubeId: string
  title: string
}

export interface WatchContent {
  enabled: boolean
  videos: VideoRef[]
}

export interface PullQuote {
  text: string
  attribution: string
}

export interface StoryContent {
  enabled: boolean
  heading: string
  paragraphs: string[]
  pullQuote?: PullQuote
}

export interface UpcomingShow {
  date: string
  venue: string
  city: string
  ticketUrl?: string
  note?: string
}

export interface PastShow {
  date: string
  venue: string
  city: string
  setlistUrl?: string
  songs?: string[]
  note?: string
}

export interface ShowsContent {
  enabled: boolean
  upcomingNote?: string
  upcoming: UpcomingShow[]
  past: PastShow[]
}

export interface MerchItem {
  name: string
  description?: string
  image: ImageRef
  url: string
  price?: string
}

export interface MerchContent {
  enabled: boolean
  items: MerchItem[]
}

export interface PressItem {
  title: string
  outlet: string
  date?: string
  url: string
}

export interface PressContent {
  enabled: boolean
  items: PressItem[]
}

export interface FooterContent {
  tagline: string
  attribution: string
}

export interface ArtistContent {
  schemaVersion: number
  slug: string
  meta: PageMeta
  integrations: Integrations
  hero: HeroContent
  listen: ListenContent
  watch: WatchContent
  story: StoryContent
  shows: ShowsContent
  merch: MerchContent
  press: PressContent
  footer: FooterContent
}
