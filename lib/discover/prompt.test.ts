/**
 *   node --import ./scripts/test/resolve-ts.mjs --test lib/discover/prompt.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildPrompt, rowsLibrary } from './prompt.ts'

const roster = [
  { slug: 'radiohead', name: 'Radiohead', identity: 'Oxford art-rock' },
  { slug: 'bjork', name: 'Björk', identity: 'Icelandic pop pioneer' },
  { slug: 'aurora', name: 'AURORA', identity: 'Norwegian art-pop' },
  { slug: 'khruangbin', name: 'Khruangbin', identity: 'Houston psych-soul trio' },
]

test('the shared prompt lists every roster artist and no one’s tiers', () => {
  const prompt = buildPrompt('2026-10-14', [], { kind: 'roster', artists: roster }, 12)
  for (const artist of roster) assert.match(prompt, new RegExp(`- ${artist.name} — `))
  assert.doesNotMatch(prompt, /HEAVY ROTATION|IN THE MIX|owner/i)
  assert.match(prompt, /WHOLE roster/)
  assert.match(prompt, /same picks every visitor sees/)
})

test('a listener’s rows prompt carries their rows, light radar, and roster exclusions', () => {
  const library = rowsLibrary(
    { radiohead: 'heavy-rotation', bjork: 'in-the-mix', aurora: 'on-the-radar', gone: 'heavy-rotation' },
    roster,
  )
  assert.equal(library.kind, 'rows')
  if (library.kind !== 'rows') return
  assert.deepEqual(library.heavy.map((a) => a.name), ['Radiohead'])
  assert.deepEqual(library.mix.map((a) => a.name), ['Björk'])
  assert.deepEqual(library.radar.map((a) => a.name), ['AURORA'])
  const prompt = buildPrompt('2026-10-14', ['Mipso'], library, 12)
  assert.match(prompt, /HEAVY ROTATION[^\n]*\n- Radiohead — /)
  assert.match(prompt, /IN THE MIX[^\n]*\n- Björk — /)
  assert.match(prompt, /ON THE RADAR[^\n]*\n- AURORA — /)
  assert.match(prompt, /never recommend these\): Radiohead, Björk, AURORA, Khruangbin/)
  assert.match(prompt, /recently recommended artists: Mipso/)
})

test('no radar section when the radar row is empty', () => {
  const library = rowsLibrary({ radiohead: 'heavy-rotation' }, roster)
  assert.doesNotMatch(buildPrompt('2026-10-14', [], library, 12), /ON THE RADAR/)
})
