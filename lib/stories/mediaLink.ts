/**
 * What a story card's media link does when clicked (owner, Nov 21 2026:
 * story card videos play on the site, on the Feed and on artist pages,
 * like every other video here).
 *
 * cards.json predates the YouTube-search ban and its media lists mix
 * verified watch URLs, search URLs and official sites. Stored output
 * outlives its generator, so every link is judged at render:
 *   play   — a YouTube video: plays inside the card
 *   search — a stored YouTube search: a labeled Apple Music search
 *   link   — anything else (an official site): a plain link out
 * ▶ is reserved for links that actually play.
 *
 * RELATIVE imports only — loaded by Node's test runner.
 */
import { isSearchUrl } from '../play/storedHref'
import { musicServiceSearchUrl } from '../listen/services'
import type { StoryMediaLink } from './types'

export type StoryMediaAction =
  | { kind: 'play'; videoId: string; label: string }
  | { kind: 'search'; href: string; text: string }
  | { kind: 'link'; href: string; text: string }

const VIDEO_ID = /^[\w-]{11}$/

/** The video a YouTube watch or youtu.be link names, or null. */
function watchVideoId(url: string): string | null {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.replace(/^(www|m)\./, '')
    const id =
      host === 'youtu.be'
        ? parsed.pathname.slice(1)
        : host === 'youtube.com' && parsed.pathname === '/watch'
          ? parsed.searchParams.get('v')
          : null
    return id && VIDEO_ID.test(id) ? id : null
  } catch {
    return null
  }
}

export function storyMediaAction(link: StoryMediaLink): StoryMediaAction {
  if (isSearchUrl(link.url)) {
    return {
      kind: 'search',
      href: musicServiceSearchUrl('appleMusic', link.label),
      text: `${link.label} — search on Apple Music ↗`,
    }
  }
  const videoId = watchVideoId(link.url)
  if (videoId) return { kind: 'play', videoId, label: link.label }
  return { kind: 'link', href: link.url, text: `${link.label} ↗` }
}
