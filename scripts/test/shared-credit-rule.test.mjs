/**
 * Shared-credit re-check (owner ruling, Oct 10, 2026): "a shared credit
 * counts only if the artist performed on that track, never on a
 * compilation."
 *   node --test scripts/test/shared-credit-rule.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sharedCreditVerdict, tracksInScope } from '../lib/sharedCreditRule.mjs'

const ARTIST = 1545918
const OTHER = 777
const track = (position, title, extra = {}) => ({ position, title, duration: '', artists: [], extraartists: [], type_: 'track', ...extra })
const record = (extra = {}) => ({
  formats: [{ name: 'Shellac', descriptions: ['10"', '78 RPM'] }],
  artists: [{ id: OTHER }, { id: ARTIST }],
  extraartists: [],
  tracklist: [track('A', 'Father Christmas'), track('B', 'Money In The Bank')],
  ...extra,
})
const verdict = (rec, uploadTitle, durationSeconds = null) =>
  sharedCreditVerdict({ artistId: ARTIST, record: rec, uploadTitle, durationSeconds })

test('a release-level shared credit alone does not show who performed the side (two-sided 78)', () => {
  const result = verdict(record(), 'The Mighty Spoiler - "Father Christmas"')
  assert.equal(result.pass, false)
  assert.equal(result.reason, 'no-performer-credit-on-track')
  assert.equal(result.looseReadingPass, true)
})

test('never on a compilation, whatever the track says', () => {
  const rec = record({
    formats: [{ name: 'Vinyl', descriptions: ['LP', 'Compilation'] }],
    tracklist: [track('A1', 'Father Christmas', { artists: [{ id: ARTIST }] })],
  })
  const result = verdict(rec, 'Father Christmas')
  assert.equal(result.pass, false)
  assert.equal(result.reason, 'compilation')
  assert.equal(result.looseReadingPass, false)
})

test('a Various Artists record is a compilation', () => {
  const rec = record({ artists: [{ id: 194 }, { id: ARTIST }] })
  assert.equal(verdict(rec, 'Father Christmas').reason, 'compilation')
})

test('a track-level artist credit on the matched track passes', () => {
  const rec = record({ tracklist: [track('A', 'Father Christmas', { artists: [{ id: ARTIST }] }), track('B', 'Money In The Bank', { artists: [{ id: OTHER }] })] })
  const result = verdict(rec, 'Father Christmas (1955)')
  assert.equal(result.pass, true)
  assert.equal(result.via, 'track-artist')
})

test('a credit on the OTHER side does not carry over', () => {
  const rec = record({ tracklist: [track('A', 'Father Christmas', { artists: [{ id: OTHER }] }), track('B', 'Money In The Bank', { artists: [{ id: ARTIST }] })] })
  assert.equal(verdict(rec, 'Father Christmas').pass, false)
})

test('a performing role on the track passes; a writing role does not', () => {
  const playing = record({ tracklist: [track('A', 'Father Christmas', { extraartists: [{ id: ARTIST, role: 'Trumpet' }] }), track('B', 'Money In The Bank')] })
  assert.equal(verdict(playing, 'Father Christmas').via, 'track-performer-role')
  const writing = record({ tracklist: [track('A', 'Father Christmas', { extraartists: [{ id: ARTIST, role: 'Written-By' }] }), track('B', 'Money In The Bank')] })
  assert.equal(verdict(writing, 'Father Christmas').pass, false)
})

test('a release-level performing role counts when its track scope covers the track', () => {
  const unscoped = record({ extraartists: [{ id: ARTIST, role: 'Leader, Lead Vocals', tracks: '' }] })
  assert.equal(verdict(unscoped, 'Father Christmas').via, 'release-performer-role')
  const otherSide = record({ extraartists: [{ id: ARTIST, role: 'Vocals', tracks: 'B' }] })
  assert.equal(verdict(otherSide, 'Father Christmas').pass, false)
  const thisSide = record({ extraartists: [{ id: ARTIST, role: 'Vocals', tracks: 'A' }] })
  assert.equal(verdict(thisSide, 'Father Christmas').pass, true)
})

test('a one-track record: the release credit can only be about that track', () => {
  const rec = record({ tracklist: [track('1', 'Raise My Flag')] })
  const result = verdict(rec, 'Juls - Raise My Flag featuring Ko-jo Cue, Blackway and E.L')
  assert.equal(result.pass, true)
  assert.equal(result.via, 'single-track-record')
})

test('a video tied to no track fails; a unique duration ties it', () => {
  assert.equal(verdict(record(), 'Calypso classics').reason, 'video-not-tied-to-a-track')
  const timed = record({ tracklist: [track('1', 'Raise My Flag', { duration: '3:20' }), track('2', 'Other', { duration: '4:40' })] })
  // Release credit only — tied by duration, then judged like any other track.
  assert.equal(verdict(timed, 'untitled upload', 201).reason, 'no-performer-credit-on-track')
  const ambiguous = record({ tracklist: [track('1', 'One', { duration: '3:20' }), track('2', 'Two', { duration: '3:21' })] })
  assert.equal(verdict(ambiguous, 'untitled upload', 201).reason, 'video-not-tied-to-a-track')
})

test('headings and index rows are not tracks', () => {
  const rec = record({ tracklist: [track('', 'Side One', { type_: 'heading' }), track('1', 'Raise My Flag')] })
  assert.equal(verdict(rec, 'Raise My Flag').via, 'single-track-record')
})

test('track scopes: lists and ranges over the record order', () => {
  const list = [track('A1', 'a'), track('A2', 'b'), track('B1', 'c'), track('B2', 'd')]
  assert.deepEqual([...tracksInScope('A1, B2', list)], ['A1', 'B2'])
  assert.deepEqual([...tracksInScope('A2 to B1', list)], ['A2', 'B1'])
  assert.deepEqual([...tracksInScope('A1 to B2', list)], ['A1', 'A2', 'B1', 'B2'])
  assert.equal(tracksInScope('', list), null)
  // A scope naming a position the record lacks matches nothing — never everything.
  assert.deepEqual([...tracksInScope('C1', list)], [])
})

test('a one-track record whose track names someone else is not about this artist', () => {
  const rec = record({ tracklist: [track('1', 'Raise My Flag', { artists: [{ id: OTHER }] })] })
  assert.equal(verdict(rec, 'Raise My Flag').pass, false)
})

test('a one-track record that does not credit this artist proves nothing (a master\'s other pressing)', () => {
  const rec = record({ artists: [{ id: OTHER }], tracklist: [track('1', 'Raise My Flag')] })
  assert.equal(verdict(rec, 'Raise My Flag').pass, false)
})

test('"… By" credits are not performing, even when a word inside looks like an instrument', () => {
  for (const role of ['Photography By', 'Arranged By [Horns]', 'Orchestrated By', 'Graphic Design', 'Written-By, Arranged By']) {
    const rec = record({ extraartists: [{ id: ARTIST, role, tracks: '' }] })
    assert.equal(verdict(rec, 'Father Christmas').pass, false, role)
  }
  const mixed = record({ extraartists: [{ id: ARTIST, role: 'Written-By, Lead Vocals', tracks: '' }] })
  assert.equal(verdict(mixed, 'Father Christmas').via, 'release-performer-role')
  const conducted = record({ extraartists: [{ id: ARTIST, role: 'Conducted By', tracks: '' }] })
  assert.equal(verdict(conducted, 'Father Christmas').via, 'release-performer-role')
})

test('hyphen and ampersand scopes, any case', () => {
  const list = [track('A1', 'a'), track('A2', 'b'), track('B1', 'c'), track('B2', 'd')]
  assert.deepEqual([...tracksInScope('A1-A2', list)], ['A1', 'A2'])
  assert.deepEqual([...tracksInScope('a1 & b2', list)], ['A1', 'B2'])
  assert.deepEqual([...tracksInScope('A2 TO B1', list)], ['A2', 'B1'])
})

test('a medley sub-track ties the video and carries its own credits', () => {
  const rec = record({
    tracklist: [
      track('A', 'Calypso Medley', { type_: 'index', sub_tracks: [
        track('A.a', 'Father Christmas', { artists: [{ id: ARTIST }] }),
        track('A.b', 'Money In The Bank', { artists: [{ id: OTHER }] }),
      ] }),
      track('B', 'Other Side'),
    ],
  })
  const result = verdict(rec, 'Father Christmas')
  assert.equal(result.pass, true)
  assert.equal(result.via, 'track-artist')
})

test('accompaniment and the instruments real records name are performing (measured on the held set)', () => {
  for (const role of ['Accompanied By', 'Accompanied By [Con]', 'Arpa', 'Harmonium', 'Kobyz', 'Tar (lute)', 'Musician', 'Ensemble']) {
    const rec = record({ extraartists: [{ id: ARTIST, role, tracks: '' }] })
    assert.equal(verdict(rec, 'Father Christmas').via, 'release-performer-role', role)
  }
  for (const role of ['Directed By [Dirigida Por]', 'Executive-Producer', 'Music Consultant [Asesor Musical]']) {
    const rec = record({ extraartists: [{ id: ARTIST, role, tracks: '' }] })
    assert.equal(verdict(rec, 'Father Christmas').pass, false, role)
  }
})

test('a JOINT credit ("A & B", "A Et B", "A With B") is a performer credit on every track that names no one else', () => {
  for (const join of ['&', 'And', 'Et', 'Y', 'With', 'Feat.', 'Accompanied By', 'E']) {
    const rec = record({ artists: [{ id: OTHER, join }, { id: ARTIST, join: '' }] })
    const result = verdict(rec, 'Father Christmas')
    assert.equal(result.pass, true, join)
    assert.equal(result.via, 'joint-credit', join)
  }
  // The artist's join to the NEXT credit counts too.
  const first = record({ artists: [{ id: ARTIST, join: '&' }, { id: OTHER, join: '' }] })
  assert.equal(verdict(first, 'Father Christmas').via, 'joint-credit')
})

test('a split or list join ("/", ",", "vs", none) is not evidence of who played the side', () => {
  for (const join of ['/', ',', 'Vs.', '-', '']) {
    const rec = record({ artists: [{ id: OTHER, join }, { id: ARTIST, join: '' }] })
    assert.equal(verdict(rec, 'Father Christmas').pass, false, JSON.stringify(join))
  }
})

test('a joint credit does not reach a track that names someone else, or a compilation', () => {
  const named = record({
    artists: [{ id: OTHER, join: '&' }, { id: ARTIST, join: '' }],
    tracklist: [track('A', 'Father Christmas', { artists: [{ id: OTHER }] }), track('B', 'Money In The Bank')],
  })
  assert.equal(verdict(named, 'Father Christmas').pass, false)
  const compiled = record({ artists: [{ id: OTHER, join: '&' }, { id: ARTIST, join: '' }], formats: [{ name: 'CD', descriptions: ['Compilation'] }] })
  assert.equal(verdict(compiled, 'Father Christmas').reason, 'compilation')
})

test('joint joins as they appear on real records: articles, French and Spanish forms, "Canta:"', () => {
  for (const join of ['Accompagné Par', 'Led By', 'Canta:', "Et L'", 'With The', 'And The', 'Y Su', 'Et Ses']) {
    const rec = record({ artists: [{ id: OTHER, join }, { id: ARTIST, join: '' }] })
    assert.equal(verdict(rec, 'Father Christmas').via, 'joint-credit', join)
  }
  for (const join of ['Pres.', 'x', '=', 'De']) {
    const rec = record({ artists: [{ id: OTHER, join }, { id: ARTIST, join: '' }] })
    assert.equal(verdict(rec, 'Father Christmas').pass, false, join)
  }
})

test('"A, B & C" is one joint list; a comma-only list is not', () => {
  const THIRD = 888
  const joint = record({ artists: [{ id: ARTIST, join: ',' }, { id: OTHER, join: '&' }, { id: THIRD, join: '' }] })
  assert.equal(verdict(joint, 'Father Christmas').via, 'joint-credit')
  const list = record({ artists: [{ id: ARTIST, join: ',' }, { id: OTHER, join: ',' }, { id: THIRD, join: '' }] })
  assert.equal(verdict(list, 'Father Christmas').pass, false)
  // A slash splits the chain: "A / B & C" says nothing about A.
  const split = record({ artists: [{ id: ARTIST, join: '/' }, { id: OTHER, join: '&' }, { id: THIRD, join: '' }] })
  assert.equal(verdict(split, 'Father Christmas').pass, false)
})

test('more joint joins seen on the held set', () => {
  for (const join of ['И', 'Accompagnés Par', 'Accompagné Par:', 'Y Su Conjunto Paraguayo', 'And His Orchestra']) {
    const rec = record({ artists: [{ id: OTHER, join }, { id: ARTIST, join: '' }] })
    assert.equal(verdict(rec, 'Father Christmas').via, 'joint-credit', join)
  }
})

test('an upload of the whole record passes only if the artist performs on EVERY track', () => {
  const joint = record({ title: 'Calypso Time', artists: [{ id: OTHER, join: '&' }, { id: ARTIST, join: '' }] })
  const whole = verdict(joint, 'Calypso Time (Full Album)')
  assert.equal(whole.pass, true)
  assert.equal(whole.tiedBy, 'record-title')
  const oneSideElsewhere = record({
    title: 'Calypso Time',
    artists: [{ id: OTHER, join: '&' }, { id: ARTIST, join: '' }],
    tracklist: [track('A', 'Father Christmas'), track('B', 'Money In The Bank', { artists: [{ id: OTHER }] })],
  })
  assert.equal(verdict(oneSideElsewhere, 'Calypso Time (Full Album)').pass, false)
  const listOnly = record({ title: 'Calypso Time', artists: [{ id: OTHER, join: ',' }, { id: ARTIST, join: '' }] })
  assert.equal(verdict(listOnly, 'Calypso Time').pass, false)
})
