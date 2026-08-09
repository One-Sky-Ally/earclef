/**
 * Apply OWNER-APPROVED joint-credit splits to the gap-fill dataset.
 * The approved list is explicit — this script can only ever split the
 * credit strings named below (Aug 8, 2026 approval: the 6 clean
 * two-id splits plus ກ. ວຶເສສ / ນາງສາວຮະບຽບ, unblocked by the
 * K. Viseth identity confirmation). Run once; idempotent.
 *
 *   node scripts/apply-credit-splits.mjs
 *
 * Each joint entry is replaced by one entry per member carrying the
 * joint entry's era span, styles, and release count (those pressings
 * credit both people). A member already present in the country's list
 * (by Discogs id or exact normalized name) is NOT duplicated. Also
 * records the owner-supplied alias set for dg:4897853 (three attested
 * Lao spellings + romanizations).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const DATASET_PATH = join(process.cwd(), 'lib', 'explore', 'extra-artists.json')

/** creditString -> [{name, discogsArtistId}] — the owner-approved set. */
const APPROVED = {
  // Round 2 (Aug 8, 2026): the three exact-overlap strings — members
  // duplicated solo entries a visitor could see twice. ບຸນທົງ and
  // RDKPL enter name-only (id-less is an established dataset class);
  // RDKPL appears in BOTH duo orderings and must land as ONE entry
  // (the in-run dedup guarantees it).
  'ໄຊຊນະ / ບຸນທົງ': [
    { name: 'ໄຊຊນະ', discogsArtistId: 9950425 },
    { name: 'ບຸນທົງ', discogsArtistId: null },
  ],
  'RDKPL* / MOGOLICO NOISE': [
    { name: 'RDKPL', discogsArtistId: null },
    { name: 'Mogolico Noise', discogsArtistId: 12606842 },
  ],
  'MOGOLICO NOISE / RDKPL': [
    { name: 'Mogolico Noise', discogsArtistId: 12606842 },
    { name: 'RDKPL', discogsArtistId: null },
  ],
  'ນິດ ວິຈິຕະວົງ / ພຣມເທບ': [
    { name: 'ນິດ ວິຈິຕະວົງ', discogsArtistId: 7781236 },
    { name: 'ພຣມເທບ', discogsArtistId: 7781235 },
  ],
  'ກ. ວຶເສສ / ນາງສາວຮະບຽບ': [
    { name: 'ກ. ວຶເສສ', discogsArtistId: 4897853 },
    { name: 'ນາງສາວຮະບຽບ', discogsArtistId: 6434178 },
  ],
  'ສົມຟອງ / ໄຊຊນະ': [
    { name: 'ສົມຟອງ', discogsArtistId: 9950524 },
    { name: 'ໄຊຊນະ', discogsArtistId: 9950425 },
  ],
  'ນິດ ວິຈິຕວົງ / ພອນເທບ': [
    { name: 'ນິດ ວິຈິຕວົງ', discogsArtistId: 9950635 },
    { name: 'ພອນເທບ', discogsArtistId: 9950638 },
  ],
  'Changoz! / Mifur': [
    { name: 'Changoz!', discogsArtistId: 3530775 },
    { name: 'Mifur', discogsArtistId: 6552092 },
  ],
  'Hellish Massacre / D.L.50': [
    { name: 'Hellish Massacre', discogsArtistId: 4788574 },
    { name: 'D.L.50', discogsArtistId: 2661322 },
  ],
  'Shitload / Mogolico Noise': [
    { name: 'Shitload', discogsArtistId: 8137328 },
    { name: 'Mogolico Noise', discogsArtistId: 12606842 },
  ],
}

/** Owner-confirmed spellings for K. Viseth (see archival-links.json). */
const VISETH_ALIASES = {
  4897853: ['ກ. ວິເສດ', 'ກ. ວິເສສ', 'K. Viseth', 'KOR VISETH'],
}

function normalizeName(value) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

const dataset = JSON.parse(readFileSync(DATASET_PATH, 'utf8'))
const report = []

for (const [country, artists] of Object.entries(dataset.countries)) {
  const next = []
  for (const artist of artists) {
    const members = APPROVED[artist.name]
    if (!members) {
      next.push(artist)
      continue
    }
    for (const member of members) {
      // Id match only when BOTH sides have one — null === null must
      // never count as "already present" for name-only members.
      const exists = next.concat(artists).some(
        (candidate) =>
          candidate !== artist &&
          ((member.discogsArtistId != null &&
            candidate.discogsArtistId === member.discogsArtistId) ||
            normalizeName(candidate.name) === normalizeName(member.name)),
      )
      if (exists) {
        report.push(`${country}: "${artist.name}" -> ${member.name} SKIPPED (already present)`)
        continue
      }
      next.push({
        name: member.name,
        source: 'discogs',
        firstYear: artist.firstYear,
        lastYear: artist.lastYear,
        styles: artist.styles,
        releaseCount: artist.releaseCount,
        discogsArtistId: member.discogsArtistId,
        wikidataId: null,
      })
      report.push(`${country}: "${artist.name}" -> ADDED ${member.name} (dg:${member.discogsArtistId})`)
    }
    report.push(`${country}: REMOVED joint entry "${artist.name}"`)
  }
  dataset.countries[country] = next
}

for (const [country, artists] of Object.entries(dataset.countries)) {
  dataset.countries[country] = artists.map((artist) =>
    VISETH_ALIASES[artist.discogsArtistId]
      ? { ...artist, aliases: VISETH_ALIASES[artist.discogsArtistId] }
      : artist,
  )
  for (const artist of dataset.countries[country]) {
    if (artist.aliases) {
      report.push(`${country}: ${artist.name} aliases = ${artist.aliases.join(' | ')}`)
    }
  }
}

writeFileSync(DATASET_PATH, `${JSON.stringify(dataset, null, 1)}\n`)
console.log(report.join('\n'))
console.log(`\ndataset written: ${DATASET_PATH}`)
