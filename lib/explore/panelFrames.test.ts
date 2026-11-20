import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { panelFrames } from './panelFrames.ts'

const egypt = { key: 'EG:1966:', panel: 'egypt' }
const finland = { key: 'FI:1971:', panel: 'finland' }

describe('panelFrames', () => {
  it('shows only the browsed panel while nothing plays', () => {
    assert.deepEqual(panelFrames(null, finland), [{ key: 'FI:1971:', role: 'browse', panel: 'finland' }])
  })

  it('shows one full panel when the playing place is the one being looked at', () => {
    assert.deepEqual(panelFrames(egypt, { ...egypt, panel: 'egypt-now' }), [
      { key: 'EG:1966:', role: 'both', panel: 'egypt-now' },
    ])
  })

  it('keeps the playing panel FIRST and the browsed one after it', () => {
    const frames = panelFrames(egypt, finland)
    assert.deepEqual(
      frames.map((frame) => [frame.key, frame.role]),
      [
        ['EG:1966:', 'playing'],
        ['FI:1971:', 'browse'],
      ],
    )
  })

  it('keeps playing when nothing is being looked at', () => {
    assert.deepEqual(panelFrames(egypt, null), [{ key: 'EG:1966:', role: 'playing', panel: 'egypt' }])
  })

  it('never moves the playing panel: a browse panel that starts playing stays put', () => {
    // Looking at Finland while Egypt plays, then Finland is played:
    // Egypt leaves, Finland becomes the one frame — nothing before it.
    const before = panelFrames(egypt, finland).map((frame) => frame.key)
    const after = panelFrames(finland, finland).map((frame) => frame.key)
    assert.deepEqual(before, ['EG:1966:', 'FI:1971:'])
    assert.deepEqual(after, ['FI:1971:'])
  })
})
