/**
 * The Discover prompt, for the two kinds of daily pool (owner ruling,
 * Oct 14 2026):
 * - `roster` — the SHARED picks everyone sees, drawn from the whole
 *   roster with no one's favourites weighting it;
 * - `rows` — one listener's own picks, from the rows they filed their
 *   follows into (today only the owner's view gets one).
 * Pure (no SDK, no I/O) so it can be tested and its size measured.
 */

export interface LibraryArtist {
  name: string
  identity: string
}

export type DiscoverLibrary =
  | { kind: 'roster'; artists: LibraryArtist[] }
  | {
      kind: 'rows'
      heavy: LibraryArtist[]
      mix: LibraryArtist[]
      radar: LibraryArtist[]
      /** Everyone already on Ear Clef — never recommended. */
      roster: string[]
    }

interface RosterEntry extends LibraryArtist {
  slug: string
}

/**
 * A listener's rows from their slug → tier map, as prompt input. Slugs
 * no longer on the roster are skipped; each row reads A–Z.
 */
export function rowsLibrary(
  tiers: Record<string, string>,
  roster: readonly RosterEntry[],
): DiscoverLibrary {
  const bySlug = new Map(roster.map((artist) => [artist.slug, artist]))
  const row = (tier: string) =>
    Object.entries(tiers)
      .filter(([, value]) => value === tier)
      .flatMap(([slug]) => {
        const artist = bySlug.get(slug)
        return artist ? [{ name: artist.name, identity: artist.identity }] : []
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  return {
    kind: 'rows',
    heavy: row('heavy-rotation'),
    mix: row('in-the-mix'),
    radar: row('on-the-radar'),
    roster: roster.map((artist) => artist.name),
  }
}

const lines = (artists: LibraryArtist[]) =>
  artists.map((artist) => `- ${artist.name} — ${artist.identity}`).join('\n')

const RULES_COMMON = (poolSize: number, avoid: string[]) => `- Also avoid these recently recommended artists: ${avoid.length > 0 ? avoid.join(', ') : '(none yet)'}
- Only real artists you are confident exist, with the name exactly as credited on releases (they will be verified against MusicBrainz; invented or misspelled names get discarded).
- "knownFor" is one real album or song title by that artist.
- Return exactly ${poolSize} picks.`

export function buildPrompt(
  date: string,
  avoid: string[],
  library: DiscoverLibrary,
  poolSize: number,
): string {
  if (library.kind === 'roster') {
    return `You are the resident ear at Ear Clef, a small curated music site. Today is ${date}. Recommend ${poolSize} artists for today's shared Discover section — the same picks every visitor sees.

Every artist on Ear Clef:

${lines(library.artists)}

Rules:
- Draw on the WHOLE roster, not anyone's favourites: spread the picks across its range — different places, eras and styles — and never cluster around a few artists.
- Recommend artists someone exploring this roster would love but has plausibly never tracked down — genuinely lesser-known discoveries, not obvious adjacent stars.
- NEVER recommend anyone already on Ear Clef (the list above).
- "why" must name the roster artist it connects to and be specific about the musical link, in one sentence.
${RULES_COMMON(poolSize, avoid)}`
  }

  const radar =
    library.radar.length > 0
      ? `\nON THE RADAR (just getting to know — a light signal):\n${lines(library.radar)}\n`
      : ''
  return `You are the resident ear at Ear Clef, a small curated music site. Today is ${date}. Recommend ${poolSize} artists for one listener's own Discover picks, from the rows they filed the artists they follow into.

HEAVY ROTATION (their all-time favourites — strongest signal):
${lines(library.heavy)}

IN THE MIX (artists they like and come back to):
${lines(library.mix)}
${radar}
Already on Ear Clef (never recommend these): ${library.roster.join(', ')}

Rules:
- Recommend artists a person with exactly these rows would love but has plausibly never tracked down — genuinely lesser-known discoveries, not obvious adjacent stars.
- Spread the picks across their range — don't cluster around one artist.
- "why" must name the artist from their rows it connects to and be specific about the musical link, in one sentence.
${RULES_COMMON(poolSize, avoid)}`
}
