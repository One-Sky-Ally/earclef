/**
 * The fallback place for an "On this day" song with no recording place
 * (owner, Oct 11 2026): "fall back to the country where the artist's
 * music happened, using the same origin rule the globe already uses to
 * place artists. If an artist made music in more than one country and
 * there's no dated way to tell which applies to that song's year, show
 * nothing for them."
 *   node --test scripts/test/on-this-day-globe-place.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { globePlace } from '../lib/onThisDayGlobePlace.mjs'

const at = (place, from = null, to = null) => ({ place, from, to })

test('one place on the globe is the answer, whatever the year', () => {
  assert.equal(globePlace([at('SE', 1995, 2010)], 2016), 'SE')
  assert.equal(globePlace([at('US')], 1934), 'US')
  // The same place listed twice is still one place.
  assert.equal(globePlace([at('US', 1950, null), at('US', 1930, 1960)], 1955), 'US')
})

test('several places: the one whose dated span covers the song\'s year', () => {
  const placements = [at('GH', 1962, 1975), at('NG', 1978, 1990)]
  assert.equal(globePlace(placements, 1970), 'GH')
  assert.equal(globePlace(placements, 1985), 'NG')
})

test('several places and no dated way to tell: nothing', () => {
  assert.equal(globePlace([at('GH'), at('NG')], 1970), null)
  // Spans that both cover the year do not tell either.
  assert.equal(globePlace([at('GH', 1960, 1980), at('NG', 1965, 1990)], 1970), null)
  // A year between spans covered by neither: nothing.
  assert.equal(globePlace([at('GH', 1962, 1975), at('NG', 1978, 1990)], 1976), null)
  // An undated place cannot rule out a dated one.
  assert.equal(globePlace([at('GH', 1962, 1975), at('NG')], 1970), null)
})

test('no place on the globe: nothing', () => {
  assert.equal(globePlace([], 1970), null)
})
