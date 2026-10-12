import type {
  ArtistContent,
  PlayContent,
  PlayTrack,
  StoryContent,
} from '@/lib/types'

/**
 * Placeholder content never reaches a visitor (owner ruling, Oct 12
 * 2026: "Visitors shouldn't see placeholder content. Hide it until I
 * fill the page in myself.").
 *
 * The content JSONs are the owner's working files, so they may carry
 * EDIT-ME prompts, tone-sketch tracks and "Placeholder" labels while a
 * page is being filled in. Those stay in the file — they are the
 * owner's to replace — and are dropped at render time instead:
 *   - story paragraphs that open with EDIT-ME / TODO / TBD / FIXME
 *   - play tracks whose title or file says "placeholder", and the
 *     whole Play section when nothing real remains
 *   - "Placeholder" album names and notes on the Play section
 *   - the hero image's "Placeholder artwork" alt text (the image stays:
 *     it is the site's standard generative artwork fallback)
 */

const EDIT_PROMPT = /^\s*(?:EDIT[\s-]?ME|TODO|TBD|FIXME)\b/i
const PLACEHOLDER = /placeholder/i

export function isPlaceholderParagraph(paragraph: string): boolean {
  return EDIT_PROMPT.test(paragraph) || PLACEHOLDER.test(paragraph.slice(0, 40))
}

export function isPlaceholderTrack(track: PlayTrack): boolean {
  return PLACEHOLDER.test(track.title) || PLACEHOLDER.test(track.file)
}

function isPlaceholderLabel(value: string | undefined): boolean {
  return value !== undefined && PLACEHOLDER.test(value)
}

export function storyWithoutPlaceholders(story: StoryContent): StoryContent {
  const paragraphs = story.paragraphs.filter(
    (paragraph) => !isPlaceholderParagraph(paragraph),
  )
  const pullQuote =
    story.pullQuote && !isPlaceholderParagraph(story.pullQuote.text)
      ? story.pullQuote
      : undefined
  return {
    ...story,
    enabled: story.enabled && (paragraphs.length > 0 || Boolean(pullQuote)),
    paragraphs,
    ...(pullQuote ? { pullQuote } : {}),
  }
}

export function playWithoutPlaceholders(play: PlayContent): PlayContent {
  const tracks = play.tracks.filter((track) => !isPlaceholderTrack(track))
  const { album, note, ...rest } = play
  return {
    ...rest,
    enabled: play.enabled && tracks.length > 0,
    tracks,
    ...(album && !isPlaceholderLabel(album) ? { album } : {}),
    ...(note && !isPlaceholderLabel(note) ? { note } : {}),
  }
}

/** The artist page's content with every placeholder removed. */
export function withoutPlaceholders(content: ArtistContent): ArtistContent {
  const hero = isPlaceholderLabel(content.hero.image.alt)
    ? { ...content.hero, image: { ...content.hero.image, alt: '' } }
    : content.hero
  return {
    ...content,
    hero,
    ...(content.play ? { play: playWithoutPlaceholders(content.play) } : {}),
    story: storyWithoutPlaceholders(content.story),
  }
}
