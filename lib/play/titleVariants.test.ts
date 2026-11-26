/**
 * Exact-variant title matching, ported from scripts/lib/extraPlayIdentity.mjs
 * for runtime use (Discover songs). Whole units only — never containment.
 *   node --test lib/play/titleVariants.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  aliasKeysOf,
  colonDurationSeconds,
  normalizeName,
  titleVariants,
  variantsIntersect,
} from './titleVariants.ts'

test('normalizeName is script-aware and exact: diacritics fold, punctuation drops, non-Latin survives', () => {
  assert.equal(normalizeName('Señor Coconut!'), 'senorcoconut')
  assert.equal(normalizeName('Поздрав На Пловдив'), 'поздравнапловдив')
  assert.equal(normalizeName(''), '')
})

test('an upload "Artist - Song (Official Video)" meets the catalog title "Song" as a whole unit', () => {
  const aliases = aliasKeysOf(['Mipso'])
  const upload = titleVariants('Mipso - Hey, Coyote (Official Music Video)', aliases)
  assert.ok(variantsIntersect(upload, titleVariants('Hey, Coyote', aliases)))
  assert.ok(!variantsIntersect(upload, titleVariants('Coyote', aliases)))
})

test('the artist name alone is never a title variant', () => {
  const aliases = aliasKeysOf(['Goat'])
  assert.equal(titleVariants('Goat', aliases).size, 0)
  assert.deepEqual([...titleVariants('Goat - Goat', aliases)], ['goatgoat'])
})

test('script sides of "A = B" and quoted spans stand alone', () => {
  const variants = titleVariants('Поздрав На Пловдив = Salut À Plovdiv')
  assert.ok(variants.has('salutaplovdiv'))
  assert.ok(variants.has('поздравнапловдив'))
  assert.ok(titleVariants('Faun Fables "O My Stars" (Official Video)').has('omystars'))
})

test('colon durations parse to seconds; empty is unknown, not zero', () => {
  assert.equal(colonDurationSeconds('3:44'), 224)
  assert.equal(colonDurationSeconds('1:02:10'), 3730)
  assert.equal(colonDurationSeconds(''), null)
  assert.equal(colonDurationSeconds(undefined), null)
})

test('Japanese uploads: full-width brackets and 「」 quotes leave the song as a whole unit (toe, Oct 2026)', () => {
  const aliases = aliasKeysOf(['toe'])
  const song = titleVariants('グッドバイ', aliases)
  assert.ok(variantsIntersect(titleVariants('toe / グッドバイ 【Official Music Video】', aliases), song))
  assert.ok(variantsIntersect(titleVariants('toe「グッドバイ」Music Video', aliases), song))
  assert.ok(variantsIntersect(titleVariants('【MV】toe - グッドバイ', aliases), song))
  assert.ok(variantsIntersect(titleVariants('toe『グッドバイ』（Live）', aliases), song))
  // Still whole units: part of the title is not the title.
  assert.ok(!variantsIntersect(titleVariants('toe / グッドバイ 【MV】', aliases), titleVariants('バイ', aliases)))
})

test('single-quoted titles count; apostrophes inside words never split a title', () => {
  const aliases = aliasKeysOf(['toe'])
  assert.ok(variantsIntersect(titleVariants("toe 'Goodbye' MV", aliases), titleVariants('Goodbye', aliases)))
  assert.ok(variantsIntersect(titleVariants('toe ‘Song Silly’ music video', aliases), titleVariants('Song Silly', aliases)))
  assert.deepEqual([...titleVariants("Don't Look Back")], ['dontlookback'])
  assert.ok(!titleVariants("Rock 'n' Roll Suicide").has('n'))
})

test('wholeTitleKeys: decorations come off, the title is never split or cut around the artist', async () => {
  const { wholeTitleKeys, aliasKeysOf } = await import('./titleVariants.ts')
  const aliases = aliasKeysOf(['Abigail Washburn'])
  assert.deepEqual([...wholeTitleKeys('Salva Nos (Live)')], ['salvanoslive', 'salvanos'])
  assert.deepEqual([...wholeTitleKeys('2016/07/20 | Big Sky')], ['20160720bigsky'])
  assert.deepEqual([...wholeTitleKeys('Wu Fei & Abigail Washburn', aliases)], ['wufeiabigailwashburn'])
  assert.deepEqual([...wholeTitleKeys('Abigail Washburn', aliases)], [])
})

test('a version note is shown only when the video carries it (Nov 25, 2026: "shown under its real title")', async () => {
  const { shownSongTitle } = await import('./titleVariants.ts')
  // The video is another version of the song: the catalogue's note goes.
  assert.equal(shownSongTitle('Lost Where I Belong (Flying Lotus Remix)', 'Andreya Triana - Lost Where I Belong (Official Video)'), 'Lost Where I Belong')
  assert.equal(shownSongTitle('Exodus / Revisited (Extended)', 'Exodus / Revisited (Edit)'), 'Exodus / Revisited')
  assert.equal(shownSongTitle('4 Better Or 4 Worse (Interlude)', 'The Pharcyde - 4 Better Or 4 Worse (Official Music Video)', aliasKeysOf(['The Pharcyde'])), '4 Better Or 4 Worse')
  assert.equal(shownSongTitle('Dreaming With Alice (Verse 1)', 'Dreaming with Alice (Verses 8 & 9)'), 'Dreaming With Alice')
  assert.equal(shownSongTitle('kisses (remixes)', 'Slowdive - kisses (Official Video)', aliasKeysOf(['Slowdive'])), 'kisses')
  assert.equal(shownSongTitle('Shri Durga (The Jagad Yoni Mix: Womb Of The World)', 'Shri Durga'), 'Shri Durga')
  // The video carries the note: it stays.
  assert.equal(shownSongTitle('Text (Totally Enormous Extinct Dinosaurs Remix)', 'Darkstar - Text (Totally Enormous Extinct Dinosaurs Remix) [Official Audio]'), 'Text (Totally Enormous Extinct Dinosaurs Remix)')
  assert.equal(shownSongTitle('Make Me Smile (Come Up And See)', 'Steve Harley & Cockney Rebel - Make Me Smile (Come Up And See Me) (Official Music Video)'), 'Make Me Smile (Come Up And See)')
  assert.equal(shownSongTitle('Section 9 (Light & Day/Reach For The Sun)', 'Light & Day / Reach for the Sun'), 'Section 9 (Light & Day/Reach For The Sun)')
  // Without the note the upload would not name it whole: the title stays as it was.
  assert.equal(shownSongTitle('Untrustable / Part 2 (About Someone Else)', 'Untrustable | (Higher Quality) Official Music Video'), 'Untrustable / Part 2 (About Someone Else)')
  // Stray spaces never reach the page.
  assert.equal(shownSongTitle(' The Viscid Substance', 'The Viscid Substance'), 'The Viscid Substance')
  assert.equal(shownSongTitle('A Mothers Love ', "A Mother's Love"), 'A Mothers Love')
})
