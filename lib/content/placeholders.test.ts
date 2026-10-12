/**
 * Placeholder content is dropped at render time, the file untouched.
 *   node --import ./scripts/test/resolve-ts.mjs --test lib/content/placeholders.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isPlaceholderParagraph,
  playWithoutPlaceholders,
  storyWithoutPlaceholders,
} from './placeholders.ts'

test('EDIT-ME prompts are placeholders; real prose is not', () => {
  assert.equal(isPlaceholderParagraph('EDIT-ME: how the project started'), true)
  assert.equal(isPlaceholderParagraph('  edit me: influences'), true)
  assert.equal(isPlaceholderParagraph('TODO fill in'), true)
  assert.equal(
    isPlaceholderParagraph(
      'Trust in the Sun is a Las Vegas–based band and recording collective.',
    ),
    false,
  )
  // "placeholder" deep inside real prose is just a word.
  assert.equal(
    isPlaceholderParagraph(
      'The band wrote the bridge as a placeholder and then kept it forever.',
    ),
    false,
  )
})

test('a story keeps only its real paragraphs and hides when none remain', () => {
  const story = storyWithoutPlaceholders({
    enabled: true,
    heading: 'The Story',
    paragraphs: ['Real.', 'EDIT-ME: later.', 'Also real.'],
  })
  assert.deepEqual(story.paragraphs, ['Real.', 'Also real.'])
  assert.equal(story.enabled, true)
  const empty = storyWithoutPlaceholders({
    enabled: true,
    heading: 'The Story',
    paragraphs: ['EDIT-ME: a', 'EDIT-ME: b'],
  })
  assert.equal(empty.enabled, false)
})

test('placeholder tone sketches never render; a real track does', () => {
  const play = playWithoutPlaceholders({
    enabled: true,
    rights: 'Owner-provided masters.',
    album: 'Placeholder Sketches',
    note: 'Placeholder tones for now.',
    tracks: [
      { title: 'Placeholder — First Light (tone sketch)', file: '01-placeholder.m4a', duration: 20 },
      { title: 'Placeholder — Golden Hour (tone sketch)', file: '02-placeholder.m4a', duration: 20 },
    ],
  })
  assert.equal(play.enabled, false)
  assert.equal(play.tracks.length, 0)
  assert.equal(play.album, undefined)
  assert.equal(play.note, undefined)

  const mixed = playWithoutPlaceholders({
    enabled: true,
    rights: 'Owner-provided masters.',
    album: 'Show Me How',
    tracks: [
      { title: 'Show Me How', file: '01-show-me-how.m4a', duration: 212 },
      { title: 'Placeholder — tone', file: '02-placeholder.m4a', duration: 20 },
    ],
  })
  assert.equal(mixed.enabled, true)
  assert.deepEqual(mixed.tracks.map((track) => track.title), ['Show Me How'])
  assert.equal(mixed.album, 'Show Me How')
})
