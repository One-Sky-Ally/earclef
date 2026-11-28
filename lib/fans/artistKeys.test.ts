/**
 * Following an artist who has no Ear Clef page yet (owner, Nov 28 2026:
 * "Add every artist I've followed from Discover so they show up in my
 * Following like the rest"). They sit in the same follows list as
 * roster slugs, keyed by their MusicBrainz id.
 *   node --import ./scripts/test/resolve-ts.mjs --test lib/fans/artistKeys.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { artistKey, mbidOfKey, pagelessView, promoteRostered, sanitizePageless } from './artistKeys.ts'

const BOOGARINS = '46713d05-4143-4704-a9c3-71b482a13944'
const RHYE = 'aa914efa-d6cb-4816-906f-8edafb08418e'

test('a page-less artist is keyed by their MusicBrainz id, and only a real one', () => {
  assert.equal(artistKey(BOOGARINS), `mb:${BOOGARINS}`)
  assert.equal(artistKey(BOOGARINS.toUpperCase()), `mb:${BOOGARINS}`)
  assert.equal(artistKey('not-an-id'), null)
  assert.equal(mbidOfKey(`mb:${BOOGARINS}`), BOOGARINS)
  assert.equal(mbidOfKey('radiohead'), null)
  assert.equal(mbidOfKey('mb:radiohead'), null)
})

test('a page-less follow keeps a name (and a thumbnail video), never anything else', () => {
  assert.deepEqual(sanitizePageless({ name: '  Boogarins ', videoId: 'abcdefghijk', extra: 1 }), {
    name: 'Boogarins',
    videoId: 'abcdefghijk',
  })
  assert.deepEqual(sanitizePageless({ name: 'Rhye', videoId: 'javascript:' }), { name: 'Rhye' })
  assert.equal(sanitizePageless({ name: '' }), null)
  assert.equal(sanitizePageless({ name: 'x'.repeat(201) }), null)
  assert.equal(sanitizePageless('Rhye'), null)
  // Control and direction-override characters never reach a page or a build request.
  assert.deepEqual(sanitizePageless({ name: 'Rh\u202eye\u0007' }), { name: 'Rhye' })
})

test('once an artist gets a page, their follow becomes the page follow, in the same row', () => {
  const record = {
    follows: ['radiohead', `mb:${BOOGARINS}`, `mb:${RHYE}`],
    tiers: { radiohead: 'heavy-rotation', [`mb:${BOOGARINS}`]: 'on-the-radar' } as const,
    artistNames: { [`mb:${BOOGARINS}`]: { name: 'Boogarins' }, [`mb:${RHYE}`]: { name: 'Rhye' } },
  }
  const promoted = promoteRostered(record, { [BOOGARINS]: 'boogarins' })
  assert.equal(promoted.changed, true)
  assert.deepEqual(promoted.follows, ['radiohead', 'boogarins', `mb:${RHYE}`])
  assert.deepEqual(promoted.tiers, { radiohead: 'heavy-rotation', boogarins: 'on-the-radar' })
  assert.deepEqual(promoted.artistNames, { [`mb:${RHYE}`]: { name: 'Rhye' } })
  // The record it was given is left as it was.
  assert.equal(record.follows[1], `mb:${BOOGARINS}`)
})

test('an artist followed both ways is listed once, and a row the fan chose on the page wins', () => {
  const promoted = promoteRostered(
    {
      follows: ['boogarins', `mb:${BOOGARINS}`],
      tiers: { boogarins: 'in-the-mix', [`mb:${BOOGARINS}`]: 'on-the-radar' },
      artistNames: { [`mb:${BOOGARINS}`]: { name: 'Boogarins' } },
    },
    { [BOOGARINS]: 'boogarins' },
  )
  assert.deepEqual(promoted.follows, ['boogarins'])
  assert.deepEqual(promoted.tiers, { boogarins: 'in-the-mix' })
})

test('nothing to promote changes nothing', () => {
  const promoted = promoteRostered({ follows: ['radiohead', `mb:${RHYE}`] }, { [BOOGARINS]: 'boogarins' })
  assert.equal(promoted.changed, false)
  assert.deepEqual(promoted.follows, ['radiohead', `mb:${RHYE}`])
})

test('the browser gets each page-less follow with its id and name; roster slugs are not in it', () => {
  assert.deepEqual(
    pagelessView(['radiohead', `mb:${RHYE}`, `mb:${BOOGARINS}`], { [`mb:${RHYE}`]: { name: 'Rhye', videoId: 'abcdefghijk' } }),
    { [`mb:${RHYE}`]: { mbid: RHYE, name: 'Rhye', videoId: 'abcdefghijk' } },
  )
})
