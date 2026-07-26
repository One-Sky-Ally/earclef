/**
 * Substance filter for feed videos — context earns the slot. A short
 * clip WITH a story is welcome; contextless filler (crowd noise titled
 * "A special moment", hashtag-only Shorts) is not. Deterministic, no
 * AI: a video is substantive when its TITLE names a work, or its
 * DESCRIPTION still says something after the promo chrome is stripped.
 * Releases never pass through here — catalog facts always rank.
 */

/** Title patterns that name an actual work or performance. */
const WORK_PATTERNS: RegExp[] = [
  /["“”'‘’«»]/, // quoted title
  /\bofficial\s+(video|audio|visuali[sz]er|lyric)/i,
  /\((official|lyric|acoustic|remix|demo|session|cover|visuali[sz]er)/i,
  /\blive\s+(at|in|from|on)\b/i,
  // "You and Whose Army? at Rock Im Park" — song-at-Venue performance
  // titles (capitalized venue keeps "a moment at the show" out).
  /\bat\s+[A-Z][\w'’]+/,
  /\b(feat|ft)\.?\s/i,
  / [-–—] /, // "Artist – Title"
]

const BOILERPLATE_PATTERNS: RegExp[] = [
  /https?:\/\/\S+/gi,
  /#[\p{L}\p{N}_]+/gu,
  /@[\w.]+/g,
  /\p{Extended_Pictographic}/gu, // emoji
  // The phrases only — eating to end-of-clause destroyed legitimate
  // prose sharing a line with a call-to-action.
  /\b(subscribe|follow us|follow on|out now|listen now|stream now|link in bio|available now|pre-?save|pre-?order now|turn on notifications|hit the bell)\b/gi,
]

const DESCRIPTION_SUBSTANCE_MIN = 80

/** The description with links, tags, handles, and promo chrome removed. */
export function cleanDescription(raw: string): string {
  let text = raw
  for (const pattern of BOILERPLATE_PATTERNS) {
    text = text.replace(pattern, ' ')
  }
  return text.replace(/\s+/g, ' ').trim()
}

export function titleNamesWork(title: string): boolean {
  return WORK_PATTERNS.some((pattern) => pattern.test(title))
}

/**
 * The agreed bar: a work-naming title OR ≥80 characters of real prose
 * in the cleaned description. Filler is DEMOTED client-side, never
 * silently deleted.
 */
export function isSubstantiveVideo(
  title: string,
  description: string,
): boolean {
  return (
    titleNamesWork(title) ||
    cleanDescription(description).length >= DESCRIPTION_SUBSTANCE_MIN
  )
}
