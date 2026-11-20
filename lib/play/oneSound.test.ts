import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createOneSound } from './oneSound.ts'

function recorder() {
  const stopped: string[] = []
  return { stopped, stop: (name: string) => () => stopped.push(name) }
}

describe('one sound at a time', () => {
  it('stops whatever was sounding when another player starts', () => {
    const sound = createOneSound()
    const { stopped, stop } = recorder()
    const queue = Symbol('queue')
    const hits = Symbol('hits')
    sound.claim(queue, stop('queue'))
    sound.claim(hits, stop('hits'))
    assert.deepEqual(stopped, ['queue'])
    assert.equal(sound.holds(hits), true)
    assert.equal(sound.holds(queue), false)
  })

  it('never stops a player for starting again (next track, resume)', () => {
    const sound = createOneSound()
    const { stopped, stop } = recorder()
    const queue = Symbol('queue')
    sound.claim(queue, stop('queue'))
    sound.claim(queue, stop('queue'))
    assert.deepEqual(stopped, [])
    assert.equal(sound.holds(queue), true)
  })

  it('hands the sound back and forth, stopping the other each time', () => {
    const sound = createOneSound()
    const { stopped, stop } = recorder()
    const a = Symbol('a')
    const b = Symbol('b')
    sound.claim(a, stop('a'))
    sound.claim(b, stop('b'))
    sound.claim(a, stop('a'))
    assert.deepEqual(stopped, ['a', 'b'])
  })

  it('forgets a player that went away, so nothing stops it later', () => {
    const sound = createOneSound()
    const { stopped, stop } = recorder()
    const a = Symbol('a')
    const b = Symbol('b')
    sound.claim(a, stop('a'))
    sound.release(a)
    sound.claim(b, stop('b'))
    assert.deepEqual(stopped, [])
  })

  it('ignores a release from a player that no longer holds the sound', () => {
    const sound = createOneSound()
    const { stopped, stop } = recorder()
    const a = Symbol('a')
    const b = Symbol('b')
    sound.claim(a, stop('a'))
    sound.claim(b, stop('b'))
    sound.release(a)
    assert.equal(sound.holds(b), true)
    assert.deepEqual(stopped, ['a'])
  })

  it('still hands over when stopping the old player fails (its player already gone)', () => {
    const sound = createOneSound()
    const a = Symbol('a')
    const b = Symbol('b')
    sound.claim(a, () => {
      throw new Error('player destroyed')
    })
    assert.doesNotThrow(() => sound.claim(b, () => {}))
    assert.equal(sound.holds(b), true)
  })
})
