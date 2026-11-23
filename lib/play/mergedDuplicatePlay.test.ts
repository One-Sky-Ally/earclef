import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mergedDuplicatePlay } from './mergedDuplicatePlay.ts'
import carried from './merged-duplicate-play.json' with { type: 'json' }
import extraPlay from '../explore/extra-play.json' with { type: 'json' }

const links = (carried as { links: Record<string, { fromKey: string; play: { url: string } }> }).links
const entries = (extraPlay as { entries: Record<string, { play: { url: string } | null; identityUnverified?: boolean; identityEvidence?: unknown }> }).entries

describe('play links carried from merged duplicates', () => {
  it('serves the carried link for the kept MusicBrainz copy', () => {
    assert.equal(
      mergedDuplicatePlay('mb:31219974-a2c8-41a3-9097-553be4b53e94')?.play.url,
      'https://www.youtube.com/watch?v=hHUM1tTZQQQ',
    )
  })

  it('says Growling Tiger\'s song is a trio recording', () => {
    assert.equal(
      mergedDuplicatePlay('mb:9a2cca5b-1cd9-45c8-89ee-c612c227e826')?.note,
      'with the Keskidee Trio, 1935',
    )
  })

  it('answers null for anything not listed, and never for non-mb keys', () => {
    assert.equal(mergedDuplicatePlay('mb:00000000-0000-0000-0000-000000000000'), null)
    assert.equal(mergedDuplicatePlay('dg:2297717'), null)
  })

  it('carries nothing for Mahmoud Darwish (the pool link was not his own voice)', () => {
    assert.equal(mergedDuplicatePlay('mb:ddefe734-0aee-4986-85f8-52c3425a0edd'), null)
  })

  it('only ever carries a link that already served for the pool copy', () => {
    for (const [key, link] of Object.entries(links)) {
      const source = entries[link.fromKey]
      assert.ok(source, `${key}: source ${link.fromKey} missing`)
      assert.equal(source.play?.url, link.play.url, key)
      assert.ok(!source.identityUnverified && source.identityEvidence, `${key}: source not serving`)
    }
  })
})
