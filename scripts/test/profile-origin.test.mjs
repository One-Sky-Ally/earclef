/**
 * Profile-origin rule (owner ruling, Sep 7, 2026) — the real profiles
 * the residue analysis surfaced, plus the edge cases the ruling named.
 *   node --test scripts/test/profile-origin.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyProfile } from '../lib/profileOrigin.mjs'

const verdict = (profile, cc) => classifyProfile(profile, cc).verdict

test('explicit nationality claims ship', () => {
  assert.equal(verdict('Kamoliddin Rakhimov – Uzbek folk singer. 1943 — 2015.', 'UZ'), 'claim')
  assert.equal(verdict('Uzbek singer, born in 1940 in Lebob.', 'UZ'), 'claim')
  assert.equal(verdict('Myskal Omurkanova (1915—1976) singer and komuz player from Kyrgyzstan.', 'KG'), 'claim')
  assert.equal(verdict('Kirghiz composer. 1915 - 1994. Transliteration: Dzhumamudun Sheraliyev', 'KG'), 'claim')
  assert.equal(verdict('Makhtumkuli Karliev (1881–1957) was a Turkmen singer and dutar player.', 'TM'), 'claim')
  assert.equal(verdict('Dutar player from Turkmenistan.', 'TM'), 'claim')
  assert.equal(verdict('Singer and rawap (lute) player from Tajikistan (born 10 February 1941, Dushanbe).', 'TJ'), 'claim')
  assert.equal(verdict('Composer, Choirmaster. Honored Artist of the Turkmen SSR, Artistic Director.', 'TM'), 'claim')
  assert.equal(verdict('Узбекский певец, народный артист Узбекской ССР.', 'UZ'), 'claim')
})

test('a claim inside a birth clause is not a claim: born-only is held', () => {
  assert.equal(verdict('Russian jazz pianist (* 1951 in Tashkent, Uzbekistan, Soviet Union).', 'UZ'), 'born-only')
  assert.equal(verdict('born: 03 September 1925 in Dushanbe, Tajik ASSR, USSR died: 26 June 2010 in New York', 'TJ'), 'born-only')
  assert.equal(verdict('Polish singer, born in Urgench, Uzbek SSR.', 'UZ'), 'born-only')
  const held = classifyProfile('Russian jazz pianist (* 1951 in Tashkent).', 'UZ')
  assert.deepEqual(held.foreignClaims, ['RU'])
})

test('the four held-list misfires now classify as claims', () => {
  assert.equal(verdict('Uzbekistan State Symphony Orchestra. For an soloists ensemble, use the other entry.', 'UZ'), 'claim')
  assert.equal(verdict('Orchestra in English: Uzbekistan (state) orchestra of folk instruments named after T. Zhalilov', 'UZ'), 'claim')
  assert.equal(verdict('Singer from Soviet Uzbekistan.', 'UZ'), 'claim')
  assert.equal(verdict('Born 1939, Uzbek composer.', 'UZ'), 'claim')
})

test('birthplace phrases stay neutral even when they name the republic', () => {
  // Born in the pool country, claiming another: held for the owner (the Antonov shape).
  assert.equal(verdict('Rafael Tolmasov (born 1923, Samarkand, Uzbekistan) was a Soviet Tajik opera singer.', 'UZ'), 'born-only')
  assert.equal(verdict('Rafael Tolmasov (born 1923, Samarkand, Uzbekistan) was a Soviet Tajik opera singer.', 'TJ'), 'claim')
  assert.equal(verdict('Roxana Babayan (Born: May 30, 1946 in Tashkent, Uzbek SSR) is a Soviet/Russian pop singer.', 'UZ'), 'born-only')
  assert.equal(verdict('Works in Tashkent as a session pianist.', 'UZ'), 'born-only')
})

test('a claim after the birth clause still counts', () => {
  assert.equal(
    verdict('(Born April 11, 1955, Stalinabad, Tajik SSR, USSR) - Tajik Soviet pop singer.', 'TJ'),
    'claim',
  )
})

test('mixed claims keep with a note', () => {
  const mixed = classifyProfile('Leonid Atabekov is a Soviet, Uzbek and Russian composer, arranger, guitarist.', 'UZ')
  assert.equal(mixed.verdict, 'mixed')
  assert.equal(mixed.poolClaim, 'Uzbek')
  assert.deepEqual(mixed.foreignClaims, ['RU'])
})

test('Soviet alone and stateless ethnonyms are neutral', () => {
  assert.equal(verdict('Soviet composer and conductor.', 'UZ'), 'none')
  assert.equal(verdict('Bukharan Jewish singer.', 'TJ'), 'none')
  assert.equal(verdict('', 'UZ'), 'none')
  assert.equal(verdict(null, 'UZ'), 'none')
})

test('claims for another nation only are foreign, and the pool country never leaks across pools', () => {
  assert.equal(verdict('Kazakh singer and dombra player.', 'UZ'), 'foreign')
  assert.equal(verdict('Kazakh singer and dombra player.', 'KZ'), 'claim')
  assert.equal(verdict('Ukrainian vocal-instrumental ensemble.', 'KG'), 'foreign')
})

test('language words and homonymous cities are not claims', () => {
  assert.equal(verdict('Composer. Born 1946, studied in Tashkent conservatoire. Transliterating in English: Khabibulla', 'UZ'), 'born-only')
  assert.equal(classifyProfile('Uzbek composer. Transliterating in English: Rakhimov', 'UZ').foreignClaims.length, 0)
  assert.equal(verdict('British actress, best known for "Mary Poppins".', 'TM'), 'foreign')
})

test('wiki-style bracketed links are ignored', () => {
  assert.equal(verdict('Uzbek vocal-instrumental ensemble "Synthesis", directed by [a=А. Китанов].', 'UZ'), 'claim')
})
