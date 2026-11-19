import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  channelMatchKind,
  channelMatchesArtist,
  channelNamesFor,
  findWork,
  isNameOnly,
  matchKey,
} from './artistMatch.ts'

const works = (titles: string[]) => titles.map((title) => ({ title, era: 'in-era' as const }))

describe('channelNamesFor', () => {
  it('keeps the MB name and typed aliases, drops search hints', () => {
    const names = channelNamesFor('細野晴臣', [
      { name: 'Haruomi Hosono', type: 'Artist name' },
      { name: 'Hosono Haruomi', type: 'Legal name' },
      { name: 'Harry Hosono', type: null },
      { name: 'Hosono', type: 'Search hint' },
    ])
    assert.ok(names.has(matchKey('細野晴臣')))
    assert.ok(names.has('haruomi hosono'))
    assert.ok(names.has('hosono haruomi'))
    assert.ok(names.has('harry hosono'))
    assert.ok(!names.has('hosono'))
  })

  it('adds the name and an alias together, in either order', () => {
    const names = channelNamesFor('Лев Лещенко', [{ name: 'Lev Leshchenko', type: 'Artist name' }])
    assert.ok(names.has('лев лещенко lev leshchenko'))
    assert.ok(names.has('lev leshchenko лев лещенко'))
  })

  it('never yields an empty name', () => {
    assert.equal(channelNamesFor('', []).size, 0)
    assert.ok(!channelNamesFor('***', [{ name: '!!', type: null }]).has(''))
  })
})

describe('channelMatchesArtist', () => {
  const names = channelNamesFor('Uhm Jung-hwa', [{ name: '엄정화', type: 'Artist name' }])

  it('accepts Topic channels and the name in either script', () => {
    assert.ok(channelMatchesArtist('Uhm Jung Hwa - Topic', names))
    assert.ok(channelMatchesArtist('엄정화', names))
    assert.ok(channelMatchesArtist('엄정화 Uhm Jung Hwa', names))
  })

  it('accepts the official-channel suffixes', () => {
    const baccara = channelNamesFor('Baccara', [])
    assert.ok(channelMatchesArtist('BaccaraVEVO', baccara))
    assert.ok(channelMatchesArtist('Baccara Official', baccara))
    assert.ok(channelMatchesArtist('Baccara Music', baccara))
  })

  it('treats spacing and punctuation as the same name', () => {
    assert.ok(channelMatchesArtist('ACDC', channelNamesFor('AC/DC', [])))
  })

  it('rejects other channels and empty titles', () => {
    assert.ok(!channelMatchesArtist('Uhm Jung Hwa Fan Club', names))
    assert.ok(!channelMatchesArtist('Baccara Records Germany', channelNamesFor('Baccara', [])))
    assert.ok(!channelMatchesArtist('', names))
    assert.ok(!channelMatchesArtist(' - Topic', names))
  })
})

describe('channelMatchKind', () => {
  const aliases = [{ name: '엄정화', type: 'Artist name' }]
  it('names how the channel matched', () => {
    assert.equal(channelMatchKind('Uhm Jung Hwa - Topic', 'Uhm Jung-hwa', aliases), 'name')
    assert.equal(channelMatchKind('엄정화', 'Uhm Jung-hwa', aliases), 'alias')
    assert.equal(channelMatchKind('엄정화 Uhm Jung Hwa', 'Uhm Jung-hwa', aliases), 'both-scripts')
    assert.equal(channelMatchKind('Someone Else', 'Uhm Jung-hwa', aliases), null)
  })
})

describe('findWork', () => {
  it('matches a Latin title only on word boundaries', () => {
    assert.equal(findWork('Lovely Day (Official Audio)', works(['Love'])), null)
    assert.equal(findWork('Love (Remastered)', works(['Love']))?.title, 'Love')
  })

  it('prefers the longest title the upload names', () => {
    const found = findWork('Esclavos Del Destino', works(['Destino', 'Esclavos del destino']))
    assert.equal(found?.title, 'Esclavos del destino')
  })

  it('matches non-Latin titles by containment', () => {
    assert.equal(findWork('細野晴臣 - 恋は桃色', works(['恋は桃色']))?.title, '恋は桃色')
    assert.equal(findWork('二泉映月二胡独奏', works(['二泉映月']))?.title, '二泉映月')
  })

  it('ignores titles that name a kind of record, not a work', () => {
    assert.equal(findWork('High Tone - X Ray - Live', works(['Live'])), null)
    assert.equal(findWork('Greatest Hits Medley', works(['Greatest Hits'])), null)
    assert.equal(findWork('Live and Let Die', works(['Live and Let Die']))?.title, 'Live and Let Die')
  })

  it('ignores titles too short to identify anything', () => {
    assert.equal(findWork('Oh My Love', works(['Oh'])), null)
    assert.equal(findWork('愛してる', works(['愛'])), null)
    assert.equal(findWork('anything', works(['', '!!'])), null)
  })
})

describe('isNameOnly', () => {
  it('flags a self-titled record and fragments of the name', () => {
    assert.ok(isNameOnly('Lena Horne', 'Lena Horne'))
    assert.ok(isNameOnly('Lena', 'Lena Horne'))
    assert.ok(!isNameOnly('Stormy Weather', 'Lena Horne'))
    assert.ok(!isNameOnly('Lenny', 'Lena Horne'))
    assert.ok(!isNameOnly('', 'Lena Horne'))
  })
})
