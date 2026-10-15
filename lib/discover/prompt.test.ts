/**
 *   node --import ./scripts/test/resolve-ts.mjs --test lib/discover/prompt.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildStockPrompt, rowsLibrary } from './prompt.ts'

const roster = [
  { slug: 'radiohead', name: 'Radiohead', identity: 'Oxford art-rock' },
  { slug: 'bjork', name: 'Björk', identity: 'Icelandic pop pioneer' },
  { slug: 'aurora', name: 'AURORA', identity: 'Norwegian art-pop' },
  { slug: 'khruangbin', name: 'Khruangbin', identity: 'Houston psych-soul trio' },
]

test('the shared brief lists every roster artist with its id and no one’s tiers', () => {
  const prompt = buildStockPrompt({
    library: { kind: 'roster', artists: roster },
    count: 220,
    setSize: 12,
    avoid: ['Mipso'],
  })
  for (const artist of roster) {
    assert.match(prompt, new RegExp(`- ${artist.name} \\[${artist.slug}\\] — `))
  }
  assert.doesNotMatch(prompt, /HEAVY ROTATION|IN THE MIX|owner/i)
  assert.match(prompt, /WHOLE roster/)
  assert.match(prompt, /daily sets of 12/)
  assert.match(prompt, /already-stocked list: Mipso/)
  assert.match(prompt, /Write exactly 220 candidates as JSON/)
})

test('the owner’s brief carries their rows, a light radar and the roster as never-recommend', () => {
  const library = rowsLibrary(
    { radiohead: 'heavy-rotation', bjork: 'in-the-mix', aurora: 'on-the-radar', gone: 'heavy-rotation' },
    roster,
  )
  assert.equal(library.kind, 'rows')
  if (library.kind !== 'rows') return
  assert.deepEqual(library.heavy.map((a) => a.name), ['Radiohead'])
  const prompt = buildStockPrompt({ library, count: 140, setSize: 8, avoid: [] })
  assert.match(prompt, /HEAVY ROTATION[^\n]*\n- Radiohead \[radiohead\] — /)
  assert.match(prompt, /IN THE MIX[^\n]*\n- Björk \[bjork\] — /)
  assert.match(prompt, /ON THE RADAR[^\n]*\n- AURORA \[aurora\] — /)
  assert.match(prompt, /never recommend these\): Radiohead, Björk, AURORA, Khruangbin/)
  assert.match(prompt, /a fresh set of 8 each day they visit/)
})

test('no radar section when the radar row is empty', () => {
  const library = rowsLibrary({ radiohead: 'heavy-rotation' }, roster)
  assert.doesNotMatch(buildStockPrompt({ library, count: 10, setSize: 8, avoid: [] }), /ON THE RADAR/)
})
