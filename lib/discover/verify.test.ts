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
  assert.deepEqual(exactNameMatch(results, 'Saba'), { mbid: 'b', canonicalName: 'Saba', top: false, article: false })
})

test('the top result still wins when it is the exact name', () => {
  const results = [artist('a', 'DANGERDOOM', 100), artist('b', 'Danger Danger', 55)]
  assert.deepEqual(exactNameMatch(results, 'DangerDoom'), { mbid: 'a', canonicalName: 'DANGERDOOM', top: true, article: false })
})

test('the top result still wins when it is the exact name, and says it was the top', () => {
  assert.deepEqual(exactNameMatch([artist('a', 'Farao', 89)], 'Farao'), { mbid: 'a', canonicalName: 'Farao', top: true, article: false })
})

test('an exact name below the score bar, no exact name, or an empty name is no match', () => {
  assert.equal(exactNameMatch([artist('a', 'Kiefer Sutherland', 100), artist('b', 'Kiefer', 80)], 'Kiefer'), null)
  assert.equal(exactNameMatch([artist('a', 'Tilman Sillescu', 100)], 'J. Tillman'), null)
  assert.equal(exactNameMatch([], 'Saba'), null)
  assert.equal(exactNameMatch([artist('a', 'Сплин', 100)], 'ДДТ'), null)
})

test('ligatures and other whole letters are spelled out (Nov 23, 2026: Mediæval Bæbes)', async () => {
  const { normalize } = await import('./verify.ts')
  assert.equal(normalize('Mediæval Bæbes'), normalize('Mediaeval Baebes'))
  assert.equal(normalize('Œuvre'), 'oeuvre')
  assert.equal(normalize('Kvelertak Øya'), 'kvelertakoya')
  assert.equal(normalize('Die Ärzte Straße'), 'diearztestrasse')
  assert.equal(normalize('Łona'), 'lona')
  assert.equal(normalize('Þursaflokkurinn'), 'thursaflokkurinn')
  assert.deepEqual(exactNameMatch([artist('m', 'Mediæval Bæbes', 100)], 'Mediaeval Baebes'), {
    mbid: 'm',
    canonicalName: 'Mediæval Bæbes',
    top: true,
    article: false,
  })
})

test('a leading "The" is set aside only when no result matches as written', () => {
  assert.deepEqual(exactNameMatch([artist('p', 'The Mike Flowers Pops', 100)], 'Mike Flowers Pops'), {
    mbid: 'p',
    canonicalName: 'The Mike Flowers Pops',
    top: true,
    article: true,
  })
  assert.deepEqual(exactNameMatch([artist('d', 'Young Dubliners', 100)], 'The Young Dubliners'), {
    mbid: 'd',
    canonicalName: 'Young Dubliners',
    top: true,
    article: true,
  })
  // Written exactly, the exact name wins over a "The" namesake ranked higher.
  assert.deepEqual(exactNameMatch([artist('t', 'The Band', 100), artist('b', 'Band', 90)], 'Band'), {
    mbid: 'b',
    canonicalName: 'Band',
    top: false,
    article: false,
  })
  assert.deepEqual(exactNameMatch([artist('tt', 'The The', 100)], 'The The'), {
    mbid: 'tt',
    canonicalName: 'The The',
    top: true,
    article: false,
  })
  // "The" alone is a name, not an article to drop.
  assert.equal(exactNameMatch([artist('x', 'Theatre', 100)], 'The'), null)
})

test('MusicBrainz is searched without a leading "The" (Nov 23, 2026: The Dirty Heads are "Dirty Heads")', async () => {
  const { searchName } = await import('./verify.ts')
  assert.equal(searchName('The Dirty Heads'), 'Dirty Heads')
  assert.equal(searchName('the Babe Rainbow'), 'Babe Rainbow')
  assert.equal(searchName('Mike Flowers Pops'), 'Mike Flowers Pops')
  assert.equal(searchName('The The'), 'The The')
  assert.equal(searchName('The'), 'The')
  assert.equal(searchName('Theatre of Tragedy'), 'Theatre of Tragedy')
})

test('the name as written is searched first, the bare name only when that finds no one', async () => {
  const { verifyCandidate } = await import('./verify.ts')
  const original = globalThis.fetch
  const asked: string[] = []
  const results: Record<string, unknown[]> = {
    'artist:"The Heads"': [artist('h', 'The Heads', 100)],
    'artist:"Heads"': [artist('t', 'Talking Heads', 100), artist('h', 'The Heads', 84)],
    'artist:"The Dirty Heads"': [],
    'artist:"Dirty Heads"': [artist('d', 'Dirty Heads', 100)],
  }
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input))
    if (url.pathname.endsWith('/artist')) {
      const query = url.searchParams.get('query') ?? ''
      asked.push(query)
      return new Response(JSON.stringify({ artists: results[query] ?? [] }), { status: 200 })
    }
    return new Response('busy', { status: 503 }) // stop each check after the name step
  }) as typeof fetch
  const context = { rosterKeys: new Set<string>(), rosterSlugs: new Set<string>(), songDeadline: Date.now() + 60_000 }
  try {
    await verifyCandidate({ name: 'The Heads', why: '', knownFor: 'Relaxing with...', connectsTo: [] }, context)
    assert.deepEqual(asked, ['artist:"The Heads"'])
    asked.length = 0
    await verifyCandidate({ name: 'The Dirty Heads', why: '', knownFor: 'Any Port in a Storm', connectsTo: [] }, context)
    assert.deepEqual(asked, ['artist:"The Dirty Heads"', 'artist:"Dirty Heads"'])
  } finally {
    globalThis.fetch = original
  }
})

test('a match found only without "The" counts only when the knownFor title is in its catalogue', async () => {
  const { verifyCandidate } = await import('./verify.ts')
  const original = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input))
    const body = url.pathname.endsWith('/artist')
      ? { artists: [artist('p', 'The Mike Flowers Pops', 100)] }
      : url.pathname.endsWith('/release-group')
        ? { 'release-groups': [{ title: 'A Groovy Place', 'first-release-date': '1996', 'primary-type': 'Album' }] }
        : { count: 0 }
    return new Response(JSON.stringify(body), { status: 200 })
  }) as typeof fetch
  try {
    const out = await verifyCandidate(
      { name: 'Mike Flowers Pops', why: '', knownFor: 'Not Their Record', connectsTo: [] },
      { rosterKeys: new Set(), rosterSlugs: new Set(), songDeadline: Date.now() + 60_000 },
    )
    assert.deepEqual(out, { pick: null, reason: 'not on MusicBrainz' })
  } finally {
    globalThis.fetch = original
  }
})

test('a catalogue MusicBrainz never answered for is not a verdict (Nov 23, 2026: Dirty Heads)', async () => {
  const { verifyCandidate } = await import('./verify.ts')
  const original = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input))
    if (url.pathname.endsWith('/release-group')) return new Response('busy', { status: 503 })
    return new Response(JSON.stringify({ artists: [artist('d', 'Dirty Heads', 100)] }), { status: 200 })
  }) as typeof fetch
  try {
    const out = await verifyCandidate(
      { name: 'The Dirty Heads', why: '', knownFor: 'Any Port in a Storm', connectsTo: [] },
      { rosterKeys: new Set(), rosterSlugs: new Set(), songDeadline: Date.now() + 60_000 },
    )
    assert.deepEqual(out, { pick: null, reason: 'musicbrainz unavailable' })
  } finally {
    globalThis.fetch = original
  }
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

test('studio albums: Album groups without secondary types, newest first', async () => {
  const { studioAlbums } = await import('./verify.ts')
  const groups = [
    { title: 'Mott', 'primary-type': 'Album', 'secondary-types': [], 'first-release-date': '1973-07' },
    { title: 'Live', 'primary-type': 'Album', 'secondary-types': ['Live'], 'first-release-date': '1974' },
    { title: 'The Best Of', 'primary-type': 'Album', 'secondary-types': ['Compilation'], 'first-release-date': '2013' },
    { title: 'All the Young Dudes', 'primary-type': 'Album', 'first-release-date': '1972-09' },
    { title: 'Roll Away the Stone', 'primary-type': 'Single', 'secondary-types': [], 'first-release-date': '1973' },
  ]
  assert.deepEqual(studioAlbums(groups), ['Mott', 'All the Young Dudes'])
})
