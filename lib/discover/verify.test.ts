/**
 * The MusicBrainz exact-name match for Discover candidates: the best-
 * scoring result named exactly like the candidate, never just the top
 * result (Oct 27, 2026: the rapper Saba sat under Joseph Saba, and
 * Farao under Massimo Faraò, so both were skipped "not on MusicBrainz").
 *   node --import ./scripts/test/resolve-ts.mjs --test lib/discover/verify.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { exactNameMatch } from './verify.ts'

const artist = (id: string, name: string, score: number) => ({ id, name, score })

test('a namesake ranked above the exact name is passed over', () => {
  const results = [artist('a', 'Joseph Saba', 100), artist('b', 'Saba', 85), artist('c', 'Saba Saba', 78)]
  assert.deepEqual(exactNameMatch(results, 'Saba'), { mbid: 'b', canonicalName: 'Saba', top: false })
})

test('the top result still wins when it is the exact name', () => {
  const results = [artist('a', 'DANGERDOOM', 100), artist('b', 'Danger Danger', 55)]
  assert.deepEqual(exactNameMatch(results, 'DangerDoom'), { mbid: 'a', canonicalName: 'DANGERDOOM', top: true })
})

test('the top result still wins when it is the exact name, and says it was the top', () => {
  assert.deepEqual(exactNameMatch([artist('a', 'Farao', 89)], 'Farao'), { mbid: 'a', canonicalName: 'Farao', top: true })
})

test('an exact name below the score bar, no exact name, or an empty name is no match', () => {
  assert.equal(exactNameMatch([artist('a', 'Kiefer Sutherland', 100), artist('b', 'Kiefer', 80)], 'Kiefer'), null)
  assert.equal(exactNameMatch([artist('a', 'Tilman Sillescu', 100)], 'J. Tillman'), null)
  assert.equal(exactNameMatch([], 'Saba'), null)
  assert.equal(exactNameMatch([artist('a', 'Сплин', 100)], 'ДДТ'), null)
})

test('a match below a namesake counts only when the knownFor title is in its catalogue', async () => {
  const { verifyCandidate } = await import('./verify.ts')
  const original = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input))
    const body = url.pathname.endsWith('/artist')
      ? { artists: [artist('a', 'Joseph Saba', 100), artist('b', 'Saba', 90)] }
      : url.pathname.endsWith('/release-group')
        ? { 'release-groups': [{ title: 'Another Saba Album', 'first-release-date': '2019', 'primary-type': 'Album' }] }
        : { count: 0 }
    return new Response(JSON.stringify(body), { status: 200 })
  }) as typeof fetch
  try {
    const out = await verifyCandidate(
      { name: 'Saba', why: '', knownFor: 'Care for Me', connectsTo: [] },
      { rosterKeys: new Set(), rosterSlugs: new Set(), songDeadline: Date.now() + 60_000 },
    )
    assert.deepEqual(out, { pick: null, reason: 'not on MusicBrainz' })
  } finally {
    globalThis.fetch = original
  }
})
