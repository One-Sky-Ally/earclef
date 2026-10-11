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
