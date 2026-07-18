/**
 * Story-card storage: the farmed cards live in cards.json (committed, so
 * "cached forever" is just git), and owner review decisions live in the
 * Blobs "stories" store as an overlay — approving a draft publishes it
 * everywhere WITHOUT needing a GitHub commit path. Merge rules:
 *   file published + no rejection            → live
 *   file draft + overlay approval            → live (owner edits applied)
 *   overlay rejection                        → hidden everywhere
 */
import { getStore } from '@netlify/blobs'
import type { StoryCard, StoryCardsFile, StoryDecision } from './types'
import cardsFile from './cards.json'

const DECISIONS_KEY = 'decisions/v1'

let devDecisions: Record<string, StoryDecision> = {}

function store() {
  return getStore({ name: 'stories', consistency: 'strong' })
}

export function allCards(): StoryCard[] {
  return (cardsFile as StoryCardsFile).cards
}

export async function readDecisions(): Promise<Record<string, StoryDecision>> {
  try {
    return ((await store().get(DECISIONS_KEY, { type: 'json' })) ??
      {}) as Record<string, StoryDecision>
  } catch {
    return devDecisions
  }
}

export async function writeDecision(
  id: string,
  decision: StoryDecision | null,
): Promise<void> {
  const current = await readDecisions()
  const next = { ...current }
  if (decision) next[id] = decision
  else delete next[id]
  try {
    await store().setJSON(DECISIONS_KEY, next)
  } catch {
    devDecisions = next
  }
}

function withEdits(card: StoryCard, decision?: StoryDecision): StoryCard {
  if (!decision || decision.action !== 'approve') return card
  return {
    ...card,
    hook: decision.hook ?? card.hook,
    story: decision.story ?? card.story,
  }
}

/** Cards the public may see, owner decisions applied. */
export async function publishedCards(slug?: string): Promise<StoryCard[]> {
  const decisions = await readDecisions()
  return allCards()
    .filter((card) => (slug ? card.slug === slug : true))
    .filter((card) => {
      const decision = decisions[card.id]
      if (decision?.action === 'reject') return false
      if (card.status === 'published') return true
      return decision?.action === 'approve'
    })
    .map((card) => ({
      ...withEdits(card, decisions[card.id]),
      status: 'published' as const,
      holdReason: undefined,
    }))
}

/** Every draft with its current decision, for the /studio review view. */
export async function draftsForReview(): Promise<
  { card: StoryCard; decision: StoryDecision | null }[]
> {
  const decisions = await readDecisions()
  return allCards()
    .filter((card) => card.status === 'draft')
    .map((card) => ({ card, decision: decisions[card.id] ?? null }))
}
