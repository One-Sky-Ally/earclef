/**
 * Queue content gates (lib/play/contentGates.ts) — the self-titled
 * release fix and the read-time gate over cached queue tracks (owner,
 * Oct 10 2026, from the Uruguay 1996 news clip).
 *   node --test scripts/test/content-gates.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  cachedTrackPasses,
  isSelfTitled,
  namesTheSelfTitledRecord,
} from '../../lib/play/contentGates.ts'

test('a release titled with the artist\'s own name is self-titled', () => {
  assert.equal(isSelfTitled('El Cuarteto de Nos', 'El Cuarteto de Nos'), true)
  assert.equal(isSelfTitled('BEYONCÉ', 'Beyoncé'), true)
  assert.equal(isSelfTitled('Raro', 'El Cuarteto de Nos'), false)
  // Empty never matches empty (standing lesson 5).
  assert.equal(isSelfTitled('', ''), false)
  assert.equal(isSelfTitled('★', '☆'), false)
})

test('a self-titled match must name the RECORD, not just the band', () => {
  const band = 'El Cuarteto de Nos'
  assert.equal(namesTheSelfTitledRecord('El Cuarteto de Nos - Info News', band, band), false)
  assert.equal(namesTheSelfTitledRecord('El Cuarteto de Nos', band, band), false)
  assert.equal(namesTheSelfTitledRecord('Cuarteto de Nos - Puertas', band, band), false)
  assert.equal(namesTheSelfTitledRecord('El Cuarteto de Nos - El Cuarteto de Nos', band, band), true)
  assert.equal(namesTheSelfTitledRecord('El Cuarteto de Nos (Full Album)', band, band), true)
  assert.equal(namesTheSelfTitledRecord('El Cuarteto de Nos - Álbum Completo 1996', band, band), true)
  assert.equal(namesTheSelfTitledRecord('Pearl Jam - Sirens (Audio)', 'Pearl Jam', 'Pearl Jam'), false)
  assert.equal(namesTheSelfTitledRecord('Candlemass - samples of new songs from the upcoming album', 'Candlemass', 'Candlemass'), false)
})

test('cached tracks: the Uruguay 1996 news clip and self-titled strays fail, real picks pass', () => {
  const name = 'El Cuarteto de Nos'
  assert.equal(cachedTrackPasses({ title: 'El Cuarteto de Nos - Info News', eraTitle: 'El Cuarteto de Nos' }, name), false)
  assert.equal(cachedTrackPasses({ title: 'Cuarteto De Nos - Raro (Live Session) 20 Aniversario', eraTitle: 'Raro' }, name), true)
  assert.equal(cachedTrackPasses({ title: 'Beyoncé - Ego', eraTitle: 'BEYONCÉ' }, 'Beyoncé'), false)
  // The existing markers re-run over the stored era title.
  assert.equal(cachedTrackPasses({ title: 'Raro (Behind The Scenes)', eraTitle: 'Raro' }, name), false)
})

test('a cached track without an era title falls back to the title-only annotation check', () => {
  assert.equal(cachedTrackPasses({ title: 'Raro (Official Video)' }, 'El Cuarteto de Nos'), true)
  assert.equal(cachedTrackPasses({ title: 'Raro (Teaser)' }, 'El Cuarteto de Nos'), false)
})

import { isNonSongTitle, isNonSongUpload, nonMusicVerdict } from '../../lib/play/contentGates.ts'

test('promo, interview and talk annotations from the two measured samples are not songs', () => {
  const cases = [
    ['El Cuarteto de Nos - Info News', 'Raro'],
    ['Shakira - VEVO News: Can\'t Remember To Forget You', 'Can’t Remember to Forget You'],
    ['Amon Amarth - JOMSVIKING Q&A Part 2', 'Jomsviking'],
    ['RITUALZ - RADICAL MACABRO DELUXE UNBOXING', 'Radical Macabro'],
    ['Te Puedo Sentir - Alex Campos (Tutorial en Guitarra)', 'Te puedo sentir'],
    ['Keziah Jones - Guitar Lesson "Nigerian Wood"', 'Nigerian Wood'],
    ['Amon Amarth - Berserkers At Download Recap', 'Berserker'],
    ['📹 MINHO\'s \'CALL BACK\' Making-log | Recording', 'Call Back'],
    ['ABBA - Voyage (The Story Behind The Album)', 'Voyage'],
    ['Creando El Ábum VIDA - Ep.5 | Alex Campos', 'Vida'],
    ['VACAXIONES Television (CAPITULO 019)', '19'],
    ['Un encuentro Raro', 'Raro'],
    ['АРИЯ: ЧЕРЕЗ ВСЕ ВРЕМЕНА | 6 серия', 'Через все времена'],
    ['Enya - Shepherd Moons 30th Anniversary Watch Party', 'Shepherd Moons'],
    ['Mujuice "Dirty EP" Sampler ACIDPOP 001', 'Dirty EP'],
    ['Neil Young Archives Vol. III (1976-1987) - Limited Edition Deluxe Box Set', 'Archives Vol. III'],
  ]
  for (const [title, work] of cases) assert.equal(isNonSongUpload(title, work, 'Artist'), true, title)
})

test('the markers never read the song\'s own title, and a numbered "серия" is the only kind that counts', () => {
  assert.equal(isNonSongUpload('Good News (Official Video)', 'Good News', 'Mac Miller'), false)
  assert.equal(isNonSongUpload('Encuentro (Audio Oficial)', 'Encuentro', 'Artista'), false)
  assert.equal(isNonSongUpload('Золотая серия - Лучшие песни', 'Лучшие песни', 'Артист'), false)
  assert.equal(isNonSongUpload('Boy With Luv (feat. BTS)', 'Boy With Luv', 'Halsey'), false)
  assert.equal(isNonSongTitle('Artist - Song (Tutorial)'), true)
})

test('a description that opens as an EPK, trailer or interview is a promo', () => {
  const verdict = (description) => nonMusicVerdict({ title: 'Bien clarito', workTitle: 'Bien Clarito', artistName: 'Santiago Tavella', description }).reasons
  assert.deepEqual(verdict('Un pequeño documental, o EPK com le dicen ahora, contando cosas'), ['describes-promo'])
  assert.deepEqual(verdict('Teaser trailer of the album "Lord Of The Time" by Last Knight.'), ['describes-promo'])
  assert.deepEqual(verdict('Shakira gives Vevo News an exclusive interview about the lead track'), ['describes-promo'])
  assert.deepEqual(verdict('Official music video for "Loverman"'), [])
  // First line only, as before.
  assert.deepEqual(verdict('Official video\nFilmed for an interview series in 1998'), [])
})
