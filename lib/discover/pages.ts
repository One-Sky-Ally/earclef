/**
 * A Discover pick who has since got an Ear Clef page (the refresh builds
 * pages from the owner's follows, Nov 28 2026) carries the page's slug,
 * so the card's Follow follows the page — the account stores that
 * follow under the slug, and a card asking by MusicBrainz id would
 * never read as following. Server only (reads the committed roster).
 */
import { rosterSlugByMbid } from '../fans/rosterIndex'

export function withPageSlugs<T extends { mbid: string }>(picks: readonly T[]): (T & { slug?: string })[] {
  const slugByMbid = rosterSlugByMbid()
  return picks.map((pick) => {
    const slug = slugByMbid[pick.mbid.toLowerCase()]
    return slug ? { ...pick, slug } : pick
  })
}
