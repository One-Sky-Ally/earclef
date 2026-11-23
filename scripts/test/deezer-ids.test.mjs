/**
 * Deezer artist pages count only when MusicBrainz links them AND they are
 * the same artist (Nov 23, 2026: AURORA's record also linked the UK
 * trance act Aurora; King Gizzard's, a page now named "Grand Theft Auto VI").
 *   node --test scripts/test/deezer-ids.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deezerArtistIds, nameKey, samePage } from '../fill-deezer-ids.mjs'

test('Deezer artist links are read from MusicBrainz url-rels, deduplicated', () => {
  const relations = [
    { url: { resource: 'https://www.deezer.com/artist/630' } },
    { url: { resource: 'https://www.deezer.com/en/artist/630' } },
    { url: { resource: 'https://deezer.com/artist/7068105/' } },
    { url: { resource: 'https://www.deezer.com/album/1128988121' } },
    { url: { resource: 'https://evil.example/www.deezer.com/artist/1' } },
  ]
  assert.deepEqual(deezerArtistIds(relations), ['630', '7068105'])
  assert.deepEqual(deezerArtistIds(undefined), [])
})

test('names compare without case, accents or "and"/"&"', () => {
  assert.equal(nameKey('Béla Fleck & The Flecktones'), nameKey('Bela Fleck and the Flecktones'))
  assert.equal(nameKey('AURORA'), nameKey('Aurora'))
  assert.notEqual(nameKey('Simon & Garfunkels'), nameKey('Simon & Garfunkel'))
})

const aurora = ['All My Demons Greeting Me as a Friend', 'Infections of a Different Kind (Step 1)', 'A Different Kind of Human (Step 2)', 'The Gods We Can Touch', 'What Happened to the Heart?']

test('a namesake page linked by mistake is refused: no shared releases', () => {
  const trance = { name: 'Aurora', titles: ['Craving', 'Summer Son', 'Hear You Calling', 'Ordinary World (feat. Naimee Coleman)'] }
  assert.equal(samePage('AURORA', aurora, trance), false)
})

test('a page under another credit needs five shared releases', () => {
  const gta = { name: 'Grand Theft Auto VI', titles: ['Ice Merchants', 'Flight b741', 'GTAVI: The Album'] }
  assert.equal(samePage('King Gizzard & The Lizard Wizard', ['Ice Merchants', 'Flight b741'], gta), false)
  const marley = ['Exodus', 'Kaya', 'Uprising', 'Survival', 'Natty Dread', 'Burnin\'']
  assert.equal(samePage('Bob Marley', marley, { name: 'Bob Marley & The Wailers', titles: [...marley, 'Live!'] }), true)
  assert.equal(samePage('Bob Marley', marley, { name: 'Bob Marley & The Wailers', titles: marley.slice(0, 4) }), false)
})

test('the artist’s own page passes: two shared releases, or all of a one-release page', () => {
  assert.equal(samePage('AURORA', aurora, { name: 'AURORA', titles: ['The Gods We Can Touch', 'What Happened To The Heart? - Single', 'Exist for Love'] }), true)
  assert.equal(samePage('AURORA', aurora, { name: 'AURORA', titles: ['The Gods We Can Touch', 'Exist for Love'] }), false)
  assert.equal(samePage('James Blake', ['Playing Robots Into Heaven', 'Friends That Break Your Heart'], { name: 'James Blake', titles: ['Playing Robots Into Heaven'] }), true)
  assert.equal(samePage('Coldplay', ['Moon Music'], { name: 'Coldplay', titles: [] }), false)
})
