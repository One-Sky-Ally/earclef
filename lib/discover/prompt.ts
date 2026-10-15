/**
 * The brief for writing Discover candidates during /refresh-earclef —
 * in the owner's Claude Code session, never by a server-side model call
 * (owner ruling, Oct 15 2026). Two lists:
 * - `roster` — the SHARED picks: daily sets of 12 for everyone, drawn
 *   from the whole roster with no one's favourites weighting it;
 * - `rows` — the owner's own picks: sets of 8, from the rows they filed
 *   their follows into.
 * Every candidate is verified by scripts/discover-stock.mjs before it
 * can reach the page. Pure (no I/O) so it can be tested.
 */

export interface LibraryArtist {
  /** Roster id, shown in [brackets] so candidates can name it in connectsTo. */
  slug: string
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

/**
 * A listener's rows from their slug → tier map, as brief input. Slugs
 * no longer on the roster are skipped; each row reads A–Z.
 */
export function rowsLibrary(
  tiers: Record<string, string>,
  roster: readonly LibraryArtist[],
): DiscoverLibrary {
  const bySlug = new Map(roster.map((artist) => [artist.slug, artist]))
  const row = (tier: string) =>
    Object.entries(tiers)
      .filter(([, value]) => value === tier)
      .flatMap(([slug]) => {
        const artist = bySlug.get(slug)
        return artist
          ? [{ slug: artist.slug, name: artist.name, identity: artist.identity }]
          : []
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
  artists
    .map((artist) => `- ${artist.name} [${artist.slug}] — ${artist.identity}`)
    .join('\n')

export interface StockBrief {
  library: DiscoverLibrary
  /** Candidates to write (more than the sets need: some fail verification). */
  count: number
  setSize: number
  /** Everyone already stocked or recently shown — never again. */
  avoid: string[]
}

const COMMON_RULES = ({ setSize, avoid }: StockBrief) => `- Recommend artists who are genuinely lesser-known discoveries, not obvious adjacent stars.
- Never recommend anyone already on Ear Clef, and never anyone in this already-stocked list: ${avoid.length > 0 ? avoid.join(', ') : '(none yet)'}
- Only real artists you are confident exist, with the name exactly as credited on releases. Each is checked against MusicBrainz; invented or misspelled names are discarded.
- "knownFor" is one real album or song title by that artist (it is checked against their catalogue).
- "connectsTo" lists one to three [bracketed] ids from the list above whose fans the pick is for, strongest first — copy the ids exactly.
- They are shown ${setSize} at a time in the order you list them, so every run of ${setSize} in a row should already be varied.`

const FORMAT = (count: number) => `Write exactly ${count} candidates as JSON: an array of objects {"name": string, "why": string, "knownFor": string, "connectsTo": [string, …]}.`

export function buildStockPrompt(brief: StockBrief): string {
  const { library, count } = brief
  if (library.kind === 'roster') {
    return `You are the resident ear at Ear Clef, a small curated music site. Write ${count} candidate artists for Ear Clef's SHARED Discover picks. They are shown in daily sets of ${brief.setSize}: every visitor sees the day's set, and each signed-in listener also sees the picks connected to artists they follow.

Every artist on Ear Clef:

${lines(library.artists)}

Rules:
- Draw on the WHOLE roster, not anyone's favourites: spread the picks across its range — different places, eras and styles. Listeners are shown the picks that connect to artists they follow, so cover as much of the roster as you can across the ${count}.
- "why" must name the roster artist it connects to and be specific about the musical link, in one sentence.
${COMMON_RULES(brief)}

${FORMAT(count)}`
  }

  const radar =
    library.radar.length > 0
      ? `\nON THE RADAR (just getting to know — a light signal):\n${lines(library.radar)}\n`
      : ''
  return `You are the resident ear at Ear Clef, a small curated music site. Write ${count} candidate artists for one listener's own Discover picks, from the rows they filed the artists they follow into. They see a fresh set of ${brief.setSize} each day they visit.

HEAVY ROTATION (their all-time favourites — strongest signal):
${lines(library.heavy)}

IN THE MIX (artists they like and come back to):
${lines(library.mix)}
${radar}
Already on Ear Clef (never recommend these): ${library.roster.join(', ')}

Rules:
- Recommend artists a person with exactly these rows would love but has plausibly never tracked down.
- Spread the picks across their range — don't cluster around one artist.
- "why" must name the artist from their rows it connects to and be specific about the musical link, in one sentence.
${COMMON_RULES(brief)}

${FORMAT(count)}`
}
