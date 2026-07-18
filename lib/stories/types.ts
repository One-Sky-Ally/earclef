/**
 * Story cards: editorial per-artist mini-features — a true clickbait hook,
 * a short sourced story, and verified media links. Generated once by the
 * overnight farm (scripts/build-story-cards.mjs), cached forever in
 * lib/stories/cards.json, gated by source verification:
 *   published — every claim backed by 2+ reputable fetched sources
 *   draft     — anything shakier, held for owner review in /studio
 */

export type StoryCardType =
  | 'era'
  | 'song'
  | 'screen'
  | 'collab'
  | 'anniversary'
  | 'performance'
  | 'news'

export interface StoryMediaLink {
  label: string
  url: string
}

export interface StorySource {
  title: string
  publisher: string
  url: string
}

export interface StoryCard {
  id: string
  slug: string
  artistName: string
  type: StoryCardType
  hook: string
  story: string
  media: StoryMediaLink[]
  sources: StorySource[]
  status: 'published' | 'draft'
  /** Present on drafts: why the publishing gate held it. */
  holdReason?: string
  model: string
  at: string
}

export interface StoryCardsFile {
  version: number
  cards: StoryCard[]
}

/** Owner decision recorded in the Blobs "stories" overlay. */
export interface StoryDecision {
  action: 'approve' | 'reject'
  /** Owner-edited copy, when provided at approval time. */
  hook?: string
  story?: string
  at: string
}
