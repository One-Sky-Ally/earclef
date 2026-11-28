/**
 * Magic links return only to an artist page or a fixed list of pages.
 *   node --import ./scripts/test/resolve-ts.mjs --test lib/membership/signInDest.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { signInDestination, signInLanding } from './signInDest.ts'

test('only the listed pages are destinations; anything else is the artist page', () => {
  assert.equal(signInDestination('/discover/past'), '/discover/past')
  assert.equal(signInDestination('/artists'), '/artists')
  assert.equal(signInDestination('https://evil.example'), undefined)
  assert.equal(signInDestination('//evil.example'), undefined)
  assert.equal(signInLanding('/me', 'radiohead'), '/me?signin=ok')
  assert.equal(signInLanding('/discover/past', undefined), '/discover/past?signin=ok')
  assert.equal(signInLanding('/elsewhere', 'radiohead'), '/radiohead?signin=ok#universe')
})
