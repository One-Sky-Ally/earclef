/**
 * Vetted-archival tier: OWNER-curated videos from allowlisted archive
 * channels (national archives, cultural foundations). Highest trust in
 * the chain — each mapping is a human judgment, reviewed in a commit —
 * so it resolves before everything else.
 *
 * THE GUARD RAILS (owner design, Aug 8, 2026):
 * - The allowlist authorizes SOURCES, never matches artists.
 * - Automation may VALIDATE (scripts/validate-archival.mjs checks
 *   playability and that each video sits on an allowlisted channel);
 *   it may never DISCOVER — no name/title matching populates this.
 */
import type { PlayLink } from './types'
import archivalLinks from './archival-links.json'
import archivalSources from './archival-sources.json'

interface ArchivalLink {
  videoId: string
  sourceChannelId: string
  label: string
}

const LINKS = (archivalLinks as unknown as {
  links: Record<string, ArchivalLink>
}).links

const ALLOWED_CHANNELS = new Set(
  (archivalSources as unknown as {
    sources: { channelId: string }[]
  }).sources.map((source) => source.channelId),
)

/** Owner-mapped archival video for a play key, or null. */
export function archivalPlay(key: string): PlayLink | null {
  const link = LINKS[key]
  if (!link) return null
  // Defense in depth: a mapping whose channel left the allowlist
  // stops rendering, even before the validator catches it.
  if (!ALLOWED_CHANNELS.has(link.sourceChannelId)) return null
  return {
    kind: 'archival-video',
    url: `https://www.youtube.com/watch?v=${link.videoId}`,
  }
}
