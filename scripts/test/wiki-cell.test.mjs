/**
 * Wikipedia table cells → the text a reader sees. The 1950s UK #1 page
 * prefixes the weeks cell with a hidden sort key, which the old
 * tag-strip kept: "Cara Mia — 910 weeks" (hidden 9 + shown 10).
 *   node --test scripts/test/wiki-cell.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cellText } from '../lib/wikiCell.mjs'

test('a hidden sort key is not part of the cell text (Cara Mia, 1954)', () => {
  assert.equal(cellText('<span style="display:none">9</span>10\n'), '10')
})

test('a hidden decimal sort key and an invisible footnote spacer are dropped (Emile Ford, 1959)', () => {
  const html =
    '<span style="display:none">5.5</span><span aria-hidden="true" style="visibility:hidden;color:transparent;">' +
    '<sup>[nb 8]</sup></span>6<sup id="cite&#95;ref-JointDec59&#95;23-1" class="reference">' +
    '<a href="#cite_note-JointDec59-23"><span class="cite-bracket">&#91;</span>nb 8' +
    '<span class="cite-bracket">&#93;</span></a></sup>\n'
  assert.equal(cellText(html), '6')
})

test('display:none matches with spacing and quote variants', () => {
  assert.equal(cellText("<span style='display: none;'>3</span>4"), '4')
  assert.equal(cellText('<span class="x" style="color:red; display:none">12</span>2'), '2')
})

test('visible text, links and entities are kept; footnote markers stripped', () => {
  assert.equal(
    cellText('"<a href="/wiki/Cara_Mia" title="Cara Mia">Cara Mia</a>"\n'),
    '"Cara Mia"',
  )
  assert.equal(cellText('Simon &amp; Garfunkel<sup class="reference">[a]</sup>'), 'Simon & Garfunkel')
  assert.equal(cellText('<span style="white-space:nowrap">2 July 1954</span>'), '2 July 1954')
})
