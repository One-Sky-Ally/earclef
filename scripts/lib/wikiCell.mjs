/**
 * Wikipedia table cell HTML → the text a reader sees.
 *
 * Moved out of build-number-ones.mjs (Oct 2026) so it can be tested:
 * the 1950s UK #1 page prefixes tie-week cells with a HIDDEN sort key
 * (`<span style="display:none">9</span>10`), and the old tag-strip kept
 * it — "Cara Mia — 910 weeks", "What Do You Want… — 5.56 weeks".
 * Hidden elements are removed whole before tags are stripped.
 */

export function decodeEntities(text) {
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
}

/** An opening tag whose inline style hides it from the reader. */
const HIDDEN_OPEN = /<(span|sup|div)\b[^>]*\bstyle\s*=\s*["'][^"']*\b(?:display\s*:\s*none|visibility\s*:\s*hidden)[^"']*["'][^>]*>/i

/**
 * Remove each hidden element with everything inside it, honouring
 * nested tags of the same name. An unclosed hidden element drops the
 * rest of the cell — hidden text never leaks into a value.
 */
function stripHidden(html) {
  let out = html
  for (let match = HIDDEN_OPEN.exec(out); match; match = HIDDEN_OPEN.exec(out)) {
    // A self-closing hidden tag hides nothing but itself.
    if (match[0].endsWith('/>')) {
      out = out.slice(0, match.index) + out.slice(match.index + match[0].length)
      continue
    }
    const tag = match[1].toLowerCase()
    const tagPattern = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi')
    tagPattern.lastIndex = match.index + match[0].length
    let depth = 1
    let end = out.length
    for (let inner = tagPattern.exec(out); inner; inner = tagPattern.exec(out)) {
      // Self-closing tags open nothing, so they never change the depth.
      if (inner[0].endsWith('/>')) continue
      depth += inner[1] ? -1 : 1
      if (depth === 0) {
        end = inner.index + inner[0].length
        break
      }
    }
    out = out.slice(0, match.index) + out.slice(end)
  }
  return out
}

/** Hidden-strip + tag-strip + footnote-marker strip ("[nb 2]", "[a]") + whitespace. */
export function cellText(cellHtml) {
  const text = decodeEntities(stripHidden(cellHtml).replace(/<[^>]+>/g, ''))
  return text
    .replace(/\[[^\]]{0,12}\]/g, '')
    .replace(/[†‡♦]/g, '') // best-seller/annotation daggers, not titles
    .replace(/\s+/g, ' ')
    .trim()
}
