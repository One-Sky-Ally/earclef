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
  | 'soundcloud'

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

export interface PlayTrack {
  title: string
  /** File name within the artist's audio folder, e.g. "01-song.m4a". */
  file: string
  /** Seconds — stored in JSON so no track needs preloading to render. */
  duration: number
}

/**
 * Natively hosted audio — the one sanctioned exception to "we never host
 * audio", allowed ONLY for artists whose masters the site has explicit
 * legal rights to serve. The rights statement is mandatory by schema.
 */
export interface PlayContent {
  enabled: boolean
  /** Human-readable provenance/permission statement. Required when enabled. */
  rights: string
  album?: string
  note?: string
  tracks: PlayTrack[]
}

/**
 * Stage 2 — the yearly membership. `enabled` turns on the members-only
 * Universe section. No `stripeAccountId` means the platform's own Stripe
 * account (the Aplete prototype); a Connect Standard account id routes
 * payments directly to that artist — the federated model.
 */
export interface MembershipContent {
  enabled: boolean
  /** Whole dollars for one year — a one-time payment, never a subscription. */
  priceUsd: number
  /** What the members-only section is called, e.g. "The Universe". */
  perkTitle: string
  /** Public copy under the locked section — the honest sales pitch. */
  teaser: string
  /** Stripe Connect Standard account of a federated artist. */
  stripeAccountId?: string
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
  /**
   * Owner's curation level (see lib/tiers.ts). Optional — untiered artists
   * always show. Moves to a per-user store when accounts exist.
   */
  tier?: import('@/lib/tiers').ArtistTier
  meta: PageMeta
  integrations: Integrations
  hero: HeroContent
  /** Native audio hosting — optional; see PlayContent for the legal bar. */
  play?: PlayContent
  /** Yearly membership + members-only feed — optional; see MembershipContent. */
  membership?: MembershipContent
  listen: ListenContent
  watch: WatchContent
  story: StoryContent
  shows: ShowsContent
  merch: MerchContent
  press: PressContent
  footer: FooterContent
}
