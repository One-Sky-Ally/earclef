/**
 * Era-aware panel lines (historical-map Phase A, owner go Aug 27 2026).
 *
 * One quiet, factual line per (country, era) shown when the selected
 * span intersects the era. V1 DISCIPLINE (pre-agreed policy): only
 * uncontested dissolutions and divisions — occupations, annexations
 * and partitions appear ONLY by per-line owner ruling. Deliberately
 * absent until then: the Baltic states (LV/LT/EE — "part of the Soviet
 * Union" is exactly the framing their legal-continuity doctrine
 * rejects), Kosovo, the Koreas, TL×Indonesia, PS. Lines are stored
 * verbatim — no template grammar — so the owner reviews exactly what
 * renders.
 *
 * Client-safe: ~2KB static table, no dataset imports.
 */
export interface PolityEra {
  from: number
  to: number
  line: string
}

const POLITY_ERAS: Record<string, PolityEra[]> = {
  // Soviet republics — membership dates, stated plainly.
  RU: [{ from: 1922, to: 1991, line: 'Part of the Soviet Union in this era (1922–1991).' }],
  UA: [{ from: 1922, to: 1991, line: 'Part of the Soviet Union in this era (1922–1991).' }],
  BY: [{ from: 1922, to: 1991, line: 'Part of the Soviet Union in this era (1922–1991).' }],
  GE: [{ from: 1922, to: 1991, line: 'Part of the Soviet Union in this era (1922–1991).' }],
  AM: [{ from: 1922, to: 1991, line: 'Part of the Soviet Union in this era (1922–1991).' }],
  AZ: [{ from: 1922, to: 1991, line: 'Part of the Soviet Union in this era (1922–1991).' }],
  UZ: [{ from: 1924, to: 1991, line: 'Part of the Soviet Union in this era (1924–1991).' }],
  TM: [{ from: 1924, to: 1991, line: 'Part of the Soviet Union in this era (1924–1991).' }],
  TJ: [{ from: 1929, to: 1991, line: 'Part of the Soviet Union in this era (1929–1991).' }],
  KZ: [{ from: 1936, to: 1991, line: 'Part of the Soviet Union in this era (1936–1991).' }],
  KG: [{ from: 1936, to: 1991, line: 'Part of the Soviet Union in this era (1936–1991).' }],
  MD: [{ from: 1940, to: 1991, line: 'Part of the Soviet Union in this era (1940–1991).' }],
  // Yugoslavia — the name outlived the federation in RS/ME (FRY, to 2003).
  SI: [{ from: 1945, to: 1991, line: 'Part of Yugoslavia in this era (1945–1991).' }],
  HR: [{ from: 1945, to: 1991, line: 'Part of Yugoslavia in this era (1945–1991).' }],
  MK: [{ from: 1945, to: 1991, line: 'Part of Yugoslavia in this era (1945–1991).' }],
  BA: [{ from: 1945, to: 1992, line: 'Part of Yugoslavia in this era (1945–1992).' }],
  RS: [{ from: 1945, to: 2003, line: 'Part of Yugoslavia in this era (1945–2003).' }],
  ME: [{ from: 1945, to: 2003, line: 'Part of Yugoslavia in this era (1945–2003).' }],
  // Czechoslovakia.
  CZ: [{ from: 1918, to: 1992, line: 'Part of Czechoslovakia in this era (1918–1992).' }],
  SK: [{ from: 1918, to: 1992, line: 'Part of Czechoslovakia in this era (1918–1992).' }],
  // Divided countries — the division is the fact, no side is the country.
  DE: [{ from: 1949, to: 1990, line: 'Germany was divided in this era — Federal Republic and DDR (1949–1990).' }],
  VN: [{ from: 1954, to: 1975, line: 'Vietnam was divided in this era; this archive’s Saigon-era records were pressed in South Vietnam (1954–1975).' }],
  // Record-name eras — what the records themselves carry.
  CD: [
    { from: 1908, to: 1960, line: 'Records from this era were pressed in the Belgian Congo — today’s DR Congo.' },
    { from: 1971, to: 1997, line: 'Records from this era were pressed in Zaire — today’s DR Congo.' },
  ],
  ZW: [{ from: 1965, to: 1979, line: 'Records from this era carry Rhodesia — today’s Zimbabwe.' }],
}

/**
 * Contested-history marks (owner design Aug 27; RULE owner-ratified
 * Aug 28 2026 — entries DERIVE from it, they never accumulate):
 *
 * THE RULE: the mark sits on CONTESTED GROUND — a place whose own
 * status or definition AS A WHOLE is subject to a live dispute in the
 * selected era. Parties as such don't mark (Serbia is unmarked; the
 * disputed ground is Kosovo). Segment disputes don't mark (Ukraine,
 * India, Pakistan are unmarked — statehood undisputed). Mutual
 * whole-claims mark BOTH grounds (the Koreas; China and Taiwan —
 * marking one side of a mutual dispute is itself a claim, the thing
 * this table exists to avoid). Threshold cases (Guyana's Essequibo,
 * ~70% of territory, statehood undisputed) stay unmarked until the
 * owner rules otherwise.
 *
 * One asterisk, ONE shared policy note, never a per-place history
 * paragraph. Open-ended eras (to 9999) are live disputes — the mark
 * shows on modern panels too, deliberately.
 */
export const CONTESTED_NOTE =
  'A contested history. Ear Clef makes no claims about borders or sovereignty, only about where music happened.'

const CONTESTED_ERAS: Record<string, { from: number; to: number }[]> = {
  EE: [{ from: 1940, to: 1991 }],
  LV: [{ from: 1940, to: 1991 }],
  LT: [{ from: 1940, to: 1991 }],
  TL: [{ from: 1975, to: 2002 }],
  XK: [{ from: 1945, to: 9999 }],
  KP: [{ from: 1945, to: 9999 }],
  KR: [{ from: 1945, to: 9999 }],
  PS: [{ from: 1948, to: 9999 }],
  // Aug 28 symmetry rulings: same dispute, same era, same mark.
  IL: [{ from: 1948, to: 9999 }],
  TW: [{ from: 1949, to: 9999 }],
  CN: [{ from: 1949, to: 9999 }],
  CY: [{ from: 1974, to: 9999 }],
  EH: [{ from: 1975, to: 9999 }],
}

/** Whether the selected span touches a contested era for this place. */
export function isContestedEra(
  code: string,
  yearStart: number,
  yearEnd: number,
): boolean {
  return (CONTESTED_ERAS[code] ?? []).some(
    (era) => yearStart <= era.to && yearEnd >= era.from,
  )
}

/** Lines whose era intersects the selected span, in table order. */
export function polityLinesFor(
  code: string,
  yearStart: number,
  yearEnd: number,
): string[] {
  return (POLITY_ERAS[code] ?? [])
    .filter((era) => yearStart <= era.to && yearEnd >= era.from)
    .map((era) => era.line)
}
