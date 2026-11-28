/**
 * Who a Discover candidate is on MusicBrainz. Names, alternate names and
 * spellings find the candidates; the knownFor title decides between them
 * unless the name alone does (owner, Nov 19 + Nov 24 2026: it must be the
 * right artist's music; how that is proven is ours, checked by hand).
 *   node --import ./scripts/test/resolve-ts.mjs --test lib/discover/verify.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nameMatches } from './verify.ts'

type Alias = { name: string }
const artist = (id: string, name: string, score: number, aliases: Alias[] = [], sortName?: string) => ({
  id,
  name,
  score,
  aliases,
  ...(sortName ? { 'sort-name': sortName } : {}),
})
const ids = (out: ReturnType<typeof nameMatches>) => out.matches.map((m) => `${m.mbid}:${m.namedBy}`)

test('the name alone decides only for the top result named as written with no one sharing the name', () => {
  assert.deepEqual(nameMatches([artist('a', 'Farao', 89)], 'Farao'), {
    matches: [{ mbid: 'a', canonicalName: 'Farao', namedBy: 'name' }],
    byNameAlone: true,
  })
  // Spacing and case never decide: DANGERDOOM is "Danger Doom".
  const doom = nameMatches([artist('a', 'DANGERDOOM', 100, [{ name: 'Danger Doom' }]), artist('b', 'Danger Danger', 55)], 'Danger Doom')
  assert.deepEqual(ids(doom), ['a:name'])
  assert.equal(doom.byNameAlone, true)
})

test('below a namesake, or among several, the knownFor title has to decide (no score bar)', () => {
  const saba = nameMatches([artist('a', 'Joseph Saba', 100), artist('b', 'Saba', 85), artist('c', 'Saba Saba', 78)], 'Saba')
  assert.deepEqual(ids(saba), ['b:name'])
  assert.equal(saba.byNameAlone, false)
  // TOPS scored 82 under the Four Tops, with a J-pop TOPS and a schlager Tops beside it.
  const tops = nameMatches(
    [artist('4', 'Four Tops', 100, [{ name: 'The Four Tops' }]), artist('m', 'TOPS', 82), artist('j', 'TOPS', 78), artist('s', 'Tops', 77, [{ name: 'Die Tops' }])],
    'TOPS',
  )
  assert.deepEqual(ids(tops), ['m:name', 'j:name', 's:name'])
  assert.equal(tops.byNameAlone, false)
  // The top result named as written, but a namesake further down: not by name alone.
  const two = nameMatches([artist('a', 'Pullman', 93), artist('b', 'Pullman', 60)], 'Pullman')
  assert.equal(two.byNameAlone, false)
  assert.deepEqual(ids(nameMatches([artist('a', 'Kiefer Sutherland', 100), artist('b', 'Kiefer', 80)], 'Kiefer')), ['b:name'])
})

test('alternate names MusicBrainz lists count, after names as written (Kikagaku Moyo, Cheb i Sabbah, RÜFÜS)', () => {
  const kikagaku = nameMatches([artist('k', '幾何学模様', 100, [{ name: 'Kikagaku Moyo' }], 'Kikagaku Moyo')], 'Kikagaku Moyo')
  assert.deepEqual(ids(kikagaku), ['k:alias'])
  assert.equal(kikagaku.byNameAlone, false)
  assert.deepEqual(ids(nameMatches([artist('c', 'DJ Cheb i Sabbah', 100, [{ name: 'Cheb I Sabbah' }])], 'Cheb i Sabbah')), ['c:alias'])
  const rufus = nameMatches(
    [artist('beck', 'Rufus Beck', 100), artist('du', 'RÜFÜS DU SOL', 95, [{ name: 'RÜFÜS' }]), artist('r', 'Rufus', 92)],
    'Rufus',
  )
  assert.deepEqual(ids(rufus), ['r:name', 'du:alias'])
})

test('no match: a different name, nothing found, an empty or non-Latin mismatch', () => {
  assert.deepEqual(nameMatches([artist('a', 'Tilman Sillescu', 100)], 'J. Tillman').matches, [])
  assert.deepEqual(nameMatches([], 'Saba').matches, [])
  assert.deepEqual(nameMatches([artist('a', 'Сплин', 100)], 'ДДТ').matches, [])
  assert.deepEqual(nameMatches([artist('a', 'Anyone', 100)], '!!').matches, [])
})

test('ligatures and other whole letters are spelled out (Nov 23, 2026: Mediæval Bæbes)', async () => {
  const { normalize } = await import('./verify.ts')
  assert.equal(normalize('Mediæval Bæbes'), normalize('Mediaeval Baebes'))
  assert.equal(normalize('Œuvre'), 'oeuvre')
  assert.equal(normalize('Kvelertak Øya'), 'kvelertakoya')
  assert.equal(normalize('Die Ärzte Straße'), 'diearztestrasse')
  assert.equal(normalize('Łona'), 'lona')
  assert.equal(normalize('Þursaflokkurinn'), 'thursaflokkurinn')
  assert.deepEqual(ids(nameMatches([artist('m', 'Mediæval Bæbes', 100)], 'Mediaeval Baebes')), ['m:name'])
})

test('a leading "The" set aside is the weakest way to be named alike', () => {
  assert.deepEqual(ids(nameMatches([artist('p', 'The Mike Flowers Pops', 100)], 'Mike Flowers Pops')), ['p:article'])
  assert.equal(nameMatches([artist('p', 'The Mike Flowers Pops', 100)], 'Mike Flowers Pops').byNameAlone, false)
  assert.deepEqual(ids(nameMatches([artist('d', 'Young Dubliners', 100)], 'The Young Dubliners')), ['d:article'])
  // Written exactly, the exact name comes before a "The" namesake ranked higher.
  assert.deepEqual(ids(nameMatches([artist('t', 'The Band', 100), artist('b', 'Band', 90)], 'Band')), ['b:name', 't:article'])
  assert.deepEqual(nameMatches([artist('tt', 'The The', 100)], 'The The'), {
    matches: [{ mbid: 'tt', canonicalName: 'The The', namedBy: 'name' }],
    byNameAlone: true,
  })
  // "The" alone is a name, not an article to drop.
  assert.deepEqual(nameMatches([artist('x', 'Theatre', 100)], 'The').matches, [])
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
    '"The Heads"': [artist('h', 'The Heads', 100)],
    '"Heads"': [artist('t', 'Talking Heads', 100), artist('h', 'The Heads', 84)],
    '"The Dirty Heads"': [],
    '"Dirty Heads"': [artist('d', 'Dirty Heads', 100)],
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
    assert.deepEqual(asked, ['"The Heads"'])
    asked.length = 0
    await verifyCandidate({ name: 'The Dirty Heads', why: '', knownFor: 'Any Port in a Storm', connectsTo: [] }, context)
    assert.deepEqual(asked, ['"The Dirty Heads"', '"Dirty Heads"'])
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
        : { count: 0, recordings: [] }
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
        : { count: 0, recordings: [] }
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

test('among namesakes the one whose catalogue holds the knownFor title is chosen (Nov 24, 2026: TOPS)', async () => {
  const { verifyCandidate } = await import('./verify.ts')
  const original = globalThis.fetch
  const catalogues: Record<string, string[]> = {
    j: ['Tops Best'],
    m: ['Sugar at the Gate', 'Picture You Staring'],
  }
  const read: string[] = []
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input))
    if (url.pathname.endsWith('/artist')) {
      return new Response(JSON.stringify({ artists: [artist('4', 'Four Tops', 100), artist('j', 'TOPS', 88), artist('m', 'TOPS', 82)] }), { status: 200 })
    }
    if (url.pathname.endsWith('/release-group')) {
      const id = url.searchParams.get('artist') ?? ''
      read.push(id)
      const groups = (catalogues[id] ?? []).map((title) => ({ title, 'first-release-date': '2017', 'primary-type': 'Album' }))
      return new Response(JSON.stringify({ 'release-groups': groups }), { status: 200 })
    }
    if (url.pathname.endsWith('/recording')) return new Response(JSON.stringify({ count: 0, recordings: [] }), { status: 200 })
    return new Response('busy', { status: 503 }) // the artist record: stop before the song step
  }) as typeof fetch
  const context = { rosterKeys: new Set<string>(), rosterSlugs: new Set<string>(), songDeadline: Date.now() + 60_000 }
  const lines: string[] = []
  try {
    const out = await verifyCandidate({ name: 'TOPS', why: '', knownFor: 'Sugar at the Gate', connectsTo: [] }, { ...context, trace: (line) => lines.push(line) })
    assert.deepEqual(read, ['j', 'm'], 'the J-pop TOPS is judged and passed over')
    assert.equal(out.reason, 'musicbrainz unavailable', 'the chosen artist goes on to the song step')
    assert.ok(lines.some((line) => line.includes('TOPS (m)') && line.includes('is theirs')))
    read.length = 0
    const none = await verifyCandidate({ name: 'TOPS', why: '', knownFor: 'Not Anyones', connectsTo: [] }, context)
    assert.deepEqual(none, { pick: null, reason: 'not on MusicBrainz' })
    assert.deepEqual(read, ['j', 'm'])
  } finally {
    globalThis.fetch = original
  }
})

test('the song step knows the artist by every listed name but search hints, plus the name that found them', async () => {
  const { songNames } = await import('./verify.ts')
  const rufus = {
    name: 'Rufus',
    aliases: [
      { name: 'Fufus', type: 'Search hint' },
      { name: 'Rufus & Chaka Khan', type: null },
      { name: 'Rufus featuring Chaka Khan', type: 'Artist name' },
    ],
  }
  assert.deepEqual(songNames(rufus, null), ['Rufus', 'Rufus featuring Chaka Khan', 'Rufus & Chaka Khan'])
  assert.deepEqual(songNames({ name: 'DJ Cheb i Sabbah', aliases: [] }, 'Cheb i Sabbah'), ['DJ Cheb i Sabbah', 'Cheb i Sabbah'])
  assert.deepEqual(songNames(null, null), [])
})

test('a recording confirms the knownFor title only when it IS that title, as a whole', async () => {
  const { namesRecording } = await import('./verify.ts')
  assert.equal(namesRecording([{ title: 'Blue Moon' }, { title: 'Feeling Blue' }], 'Blue'), false)
  assert.equal(namesRecording([{ title: 'Blue (2011 remaster)' }], 'Blue'), true)
  assert.equal(namesRecording([{ title: 'Sugar at the Gate' }], 'Sugar at the Gate'), true)
  assert.equal(namesRecording([], 'Blue'), false)
})

test('two namesakes who both have the knownFor title leave it open: no pick', async () => {
  const { verifyCandidate } = await import('./verify.ts')
  const original = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input))
    if (url.pathname.endsWith('/artist')) {
      return new Response(JSON.stringify({ artists: [artist('4', 'Four Tops', 100), artist('j', 'TOPS', 88), artist('m', 'TOPS', 82)] }), { status: 200 })
    }
    if (url.pathname.endsWith('/release-group')) {
      return new Response(JSON.stringify({ 'release-groups': [{ title: 'Greatest Hits', 'first-release-date': '2017', 'primary-type': 'Album' }] }), { status: 200 })
    }
    return new Response(JSON.stringify({ count: 0, recordings: [] }), { status: 200 })
  }) as typeof fetch
  try {
    const out = await verifyCandidate(
      { name: 'TOPS', why: '', knownFor: 'Greatest Hits', connectsTo: [] },
      { rosterKeys: new Set(), rosterSlugs: new Set(), songDeadline: Date.now() + 60_000 },
    )
    assert.deepEqual(out, { pick: null, reason: 'not on MusicBrainz' })
  } finally {
    globalThis.fetch = original
  }
})

test('a busy MusicBrainz answering 200 with an error body is not "not on MusicBrainz"', async () => {
  const { verifyCandidate } = await import('./verify.ts')
  const original = globalThis.fetch
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: 'The MusicBrainz web server is currently busy.' }), { status: 200 })) as typeof fetch
  try {
    const out = await verifyCandidate(
      { name: 'Pullman', why: '', knownFor: 'Turnstyles & Junkpiles', connectsTo: [] },
      { rosterKeys: new Set(), rosterSlugs: new Set(), songDeadline: Date.now() + 60_000 },
    )
    assert.deepEqual(out, { pick: null, reason: 'musicbrainz unavailable' })
  } finally {
    globalThis.fetch = original
  }
})

test('more from this artist leaves out the pick song, under any title form, and stops at nine (Nov 28 2026)', async () => {
  const { moreSongs } = await import('./verify.ts')
  const song = (videoId: string, title: string) =>
    ({ videoId, title, uploadTitle: title, kind: 'audio', source: 'channel', uploader: 'Rhye - Topic' }) as const
  const own = song('aaaaaaaaaaa', 'Open')
  const list = [
    own,
    song('bbbbbbbbbbb', 'Open (Remix)'),
    song('ccccccccccc', 'The Fall'),
    ...Array.from({ length: 12 }, (_, i) => song(`d${String(i).padStart(10, '0')}`, `Song ${i}`)),
  ]
  const more = moreSongs(list, own, ['Rhye'])
  assert.equal(more[0].title, 'The Fall')
  assert.equal(more.some((entry) => entry.videoId === own.videoId || entry.title.startsWith('Open')), false)
  assert.equal(more.length, 9)
})
