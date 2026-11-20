import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { planPins } from './globePins.ts'

const egypt = { code: 'EG', name: 'Egypt' }
const finland = { code: 'FI', name: 'Finland' }
const jamaica = { code: 'JM', name: 'Jamaica' }
const egyptPlaying = { code: 'EG', label: 'Egypt 1966' }
const notClaimed = () => false

describe('planPins', () => {
  it('names the selection alone while nothing plays', () => {
    assert.deepEqual(planPins({ selected: egypt, featured: null, playing: null, claimed: notClaimed }), [
      { code: 'EG', text: 'Egypt', role: 'selected', playing: false },
    ])
  })

  it('marks the playing place apart from the place being looked at', () => {
    assert.deepEqual(
      planPins({ selected: finland, featured: null, playing: egyptPlaying, claimed: notClaimed }),
      [
        { code: 'FI', text: 'Finland', role: 'selected', playing: false },
        { code: 'EG', text: '♪ Egypt 1966', role: 'playing', playing: true },
      ],
    )
  })

  it('keeps the playing mark with nothing selected', () => {
    assert.deepEqual(planPins({ selected: null, featured: null, playing: egyptPlaying, claimed: notClaimed }), [
      { code: 'EG', text: '♪ Egypt 1966', role: 'playing', playing: true },
    ])
  })

  it('folds the playing mark into the selection when both are the same place (any year)', () => {
    assert.deepEqual(planPins({ selected: egypt, featured: null, playing: egyptPlaying, claimed: notClaimed }), [
      { code: 'EG', text: '♪ Egypt 1966', role: 'selected', playing: true },
    ])
  })

  it('shows a featured journey only when nothing is selected, beside the playing mark', () => {
    assert.deepEqual(planPins({ selected: null, featured: jamaica, playing: egyptPlaying, claimed: notClaimed }), [
      { code: 'JM', text: 'Jamaica', role: 'featured', playing: false },
      { code: 'EG', text: '♪ Egypt 1966', role: 'playing', playing: true },
    ])
    assert.deepEqual(planPins({ selected: egypt, featured: jamaica, playing: null, claimed: notClaimed }), [
      { code: 'EG', text: 'Egypt', role: 'selected', playing: false },
    ])
  })

  it('folds the playing mark into a featured journey of the same place', () => {
    const journeyPlaying = { code: 'JM', label: 'Jamaica 1968–1972' }
    assert.deepEqual(
      planPins({ selected: null, featured: jamaica, playing: journeyPlaying, claimed: notClaimed }),
      [{ code: 'JM', text: '♪ Jamaica 1968–1972', role: 'featured', playing: true }],
    )
  })

  it('never pins a claimed place: its own marker carries the selection and the playing mark', () => {
    const tibet = { code: 'tibet', name: 'Tibet' }
    const claimed = (code: string) => code === 'tibet'
    assert.deepEqual(
      planPins({ selected: tibet, featured: null, playing: { code: 'tibet', label: 'Tibet 1990' }, claimed }),
      [],
    )
    assert.deepEqual(
      planPins({ selected: finland, featured: null, playing: { code: 'tibet', label: 'Tibet 1990' }, claimed }),
      [{ code: 'FI', text: 'Finland', role: 'selected', playing: false }],
    )
  })
})
