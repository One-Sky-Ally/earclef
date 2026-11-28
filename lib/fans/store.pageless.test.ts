/**
 * Page-less follows in the fan store (Nov 28 2026), on the in-memory
 * fallback the store uses outside Netlify.
 *   node --import ./scripts/test/resolve-ts.mjs --test lib/fans/store.pageless.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addPagelessFollows, getFan, promoteRosteredFollows, setFollow } from './store.ts'

const RHYE = 'mb:aa914efa-d6cb-4816-906f-8edafb08418e'
const BOOGARINS_ID = '46713d05-4143-4704-a9c3-71b482a13944'
const BOOGARINS = `mb:${BOOGARINS_ID}`

test('a page-less follow keeps its name while followed, and only then', async () => {
  const email = 'store-test-1@example.test'
  await setFollow(email, RHYE, true, 'on-the-radar', { name: 'Rhye', videoId: 'abcdefghijk' })
  assert.deepEqual((await getFan(email))?.artistNames, { [RHYE]: { name: 'Rhye', videoId: 'abcdefghijk' } })
  // Re-filed without a name: the stored one stays.
  await setFollow(email, RHYE, true, 'in-the-mix')
  assert.equal((await getFan(email))?.artistNames?.[RHYE]?.name, 'Rhye')
  await setFollow(email, RHYE, false)
  const after = await getFan(email)
  assert.deepEqual(after?.follows, [])
  assert.deepEqual(after?.artistNames, {})
})

test('the move adds what is new, keeps what is followed, and hands back what it could not place', async () => {
  const email = 'store-test-2@example.test'
  await setFollow(email, RHYE, true, 'heavy-rotation', { name: 'Rhye' })
  const result = await addPagelessFollows(email, [
    { key: RHYE, name: 'Rhye', tier: 'on-the-radar' },
    { key: BOOGARINS, name: 'Boogarins', tier: 'on-the-radar' },
    { key: 'mb:not-an-id', name: 'Nobody', tier: 'on-the-radar' },
  ])
  assert.deepEqual(result.added, ['Boogarins'])
  assert.deepEqual(result.kept, ['Rhye'])
  assert.deepEqual(result.skipped.map((entry) => entry.name), ['Nobody'])
  const fan = await getFan(email)
  // Rhye keeps the row the fan gave them.
  assert.equal(fan?.tiers?.[RHYE], 'heavy-rotation')
  assert.equal(fan?.tiers?.[BOOGARINS], 'on-the-radar')
})

test('a page going live turns the follow into the page follow, in the same row, once', async () => {
  const email = 'store-test-3@example.test'
  await setFollow(email, BOOGARINS, true, 'in-the-mix', { name: 'Boogarins' })
  const promoted = await promoteRosteredFollows(email, { [BOOGARINS_ID]: 'boogarins' })
  assert.deepEqual(promoted?.follows, ['boogarins'])
  assert.equal(promoted?.tiers?.boogarins, 'in-the-mix')
  assert.deepEqual(promoted?.artistNames, {})
  // Nothing left to promote: the record comes back as it is.
  const again = await promoteRosteredFollows(email, { [BOOGARINS_ID]: 'boogarins' })
  assert.deepEqual(again?.follows, ['boogarins'])
})
