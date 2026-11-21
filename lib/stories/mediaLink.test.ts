/**
 *   node --import ./scripts/test/resolve-ts.mjs --test lib/stories/mediaLink.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { storyMediaAction } from './mediaLink.ts'

test('a YouTube watch link plays here', () => {
  assert.deepEqual(
    storyMediaAction({
      label: 'Aphex Twin — Donkey Rhubarb',
      url: 'https://www.youtube.com/watch?v=G0qV2t7JCAQ',
    }),
    { kind: 'play', videoId: 'G0qV2t7JCAQ', label: 'Aphex Twin — Donkey Rhubarb' },
  )
})

test('short, mobile and extra-parameter watch links play too', () => {
  for (const url of [
    'https://youtu.be/G0qV2t7JCAQ',
    'https://m.youtube.com/watch?v=G0qV2t7JCAQ',
    'https://youtube.com/watch?feature=share&v=G0qV2t7JCAQ&t=30',
  ]) {
    const action = storyMediaAction({ label: 'x', url })
    assert.equal(action.kind, 'play', url)
    assert.equal(action.kind === 'play' && action.videoId, 'G0qV2t7JCAQ')
  }
})

test('a stored YouTube search becomes a labeled Apple Music search', () => {
  const action = storyMediaAction({
    label: 'Bonobo — Kerala',
    url: 'https://www.youtube.com/results?search_query=bonobo+kerala',
  })
  assert.equal(action.kind, 'search')
  assert.ok(action.kind === 'search' && action.href.startsWith('https://music.apple.com/'))
  assert.equal(action.kind === 'search' && action.text, 'Bonobo — Kerala — search on Apple Music ↗')
})

test('an official site is a plain link out, never a ▶', () => {
  assert.deepEqual(
    storyMediaAction({ label: 'Official site', url: 'https://bonobomusic.com' }),
    { kind: 'link', href: 'https://bonobomusic.com', text: 'Official site ↗' },
  )
})

test('a watch link without a real video id links out instead of playing', () => {
  for (const url of [
    'https://www.youtube.com/watch',
    'https://www.youtube.com/watch?v=short',
    'https://youtu.be/',
  ]) {
    assert.equal(storyMediaAction({ label: 'x', url }).kind, 'link', url)
  }
})

test('an unreadable URL is a link, never a crash', () => {
  assert.deepEqual(storyMediaAction({ label: 'x', url: 'not a url' }), {
    kind: 'link',
    href: 'not a url',
    text: 'x ↗',
  })
})

test('every video link in the stored cards plays here', async () => {
  const { default: file } = await import('./cards.json', { with: { type: 'json' } })
  const links = (file.cards as { media: { label: string; url: string }[] | null }[])
    .flatMap((card) => (Array.isArray(card.media) ? card.media : []))
    .filter((link) => /youtube\.com\/watch/.test(link.url))
  assert.ok(links.length > 0)
  assert.deepEqual(
    links.filter((link) => storyMediaAction(link).kind !== 'play'),
    [],
  )
})
