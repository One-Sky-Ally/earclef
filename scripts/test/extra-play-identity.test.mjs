/**
 * Shared play-identity helpers (scripts/lib/extraPlayIdentity.mjs) —
 * the two defects found in the Oct 10 2026 review: the Discogs "Various"
 * id, and a performing-role test that matched SUBSTRINGS ("Photography
 * By" read as rap, "Arranged By [Horns]" as horn, "Orchestrated By" as
 * orchestra).
 *   node --test scripts/test/extra-play-identity.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DISCOGS_VARIOUS_ID, isPerformingRole } from '../lib/extraPlayIdentity.mjs'

test('Discogs "Various" is artist id 194 (the dump\'s own credit)', () => {
  assert.equal(DISCOGS_VARIOUS_ID, 194)
})

test('credits that are not playing are not performing', () => {
  for (const role of [
    'Photography By', 'Graphic Design', 'Typography', 'Arranged By [Horns]', 'Orchestrated By',
    'Strings Arranged By', 'Written-By', 'Producer', 'Mastered By', 'Mixed By', 'Design',
    'Liner Notes', 'Directed By [Dirigida Por]', 'Executive-Producer', 'Music Consultant [Asesor Musical]',
    'Written-By, Arranged By', 'Lacquer Cut By', 'Artwork',
  ]) {
    assert.equal(isPerformingRole(role), false, role)
  }
})

test('playing, singing and leading are performing, including the "… By" forms that mean it', () => {
  for (const role of [
    'Vocals', 'Lead Vocals', 'Backing Vocals', 'Featuring', 'Guitar', 'Bass', 'Drums', 'Rap',
    'Saxophone', 'Trumpet', 'Horns', 'Strings', 'Orchestra', 'Band', 'Choir', 'Conductor',
    'Performer', 'Kora', 'Turntables', 'DJ Mix', 'Leader, Lead Vocals', 'Written-By, Lead Vocals',
    'Performed By', 'Conducted By', 'Accompanied By', 'Accompanied By [Con]',
    'Arpa', 'Harmonium', 'Kobyz', 'Tar (lute)', 'Musician', 'Ensemble', 'Voice',
    // Seen on the 15 serving links the fix touched (Oct 10): a bracket can
    // carry the performing word, and real instruments the list lacked.
    'Oboe [Soloist]', 'Other [Whooping Choir]', 'Duduk', 'Synthesizer', 'Synthesizer, Piano',
    'Mandolin', 'Banjo', 'Congas', 'Timbales', 'Ngoni', 'Djembe', 'Vibraphone', 'Tuba', 'Viola',
  ]) {
    assert.equal(isPerformingRole(role), true, role)
  }
})

test('words are whole: "Husband", "Console", "Leadership Award" are not roles', () => {
  for (const role of ['Husband', 'Console Operator', 'Thanks [Husband]']) {
    assert.equal(isPerformingRole(role), false, role)
  }
})
