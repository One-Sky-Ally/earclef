// One-off closing-pass helper: list feed-blurb cache misses with full item
// metadata as JSON, so blurbs can be generated in-session (zero wallet) and
// seeded via /api/studio/seed-blurbs. Mirrors warm-blurbs.mjs exactly:
// same key derivation, same cache-only probe, same visible-window logic —
// plus per-slug scoping for a list of slugs.
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const SITE = process.env.EARCLEF_SITE ?? 'https://earclef.com'

function normalizedTitle(title) {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[([](feat|ft|with|deluxe|expanded|remaster(ed)?|special)[^)\]]*[)\]]/g, '')
    .replace(/[^a-z0-9]+/g, '')
}
const blurbKey = (slug, type, title) =>
  `v2/${slug}/${type}/${normalizedTitle(title) || 'untitled'}`

const slugsArg = process.argv[2]
const slugs = slugsArg ? new Set(slugsArg.split(',')) : null

const res = await fetch(`${SITE}/api/feed/snapshot`)
if (!res.ok) {
  console.error(`snapshot unavailable HTTP ${res.status}`)
  process.exit(1)
}
const { items } = await res.json()

const wanted = items
  .filter((item) => (slugs ? slugs.has(item.slug) : true))
  .sort((a, b) => b.date.localeCompare(a.date))

const misses = []
for (let i = 0; i < wanted.length; i += 12) {
  const chunk = wanted.slice(i, i + 12)
  const probe = await fetch(`${SITE}/api/feed/blurbs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      items: chunk.map((item) => ({
        slug: item.slug,
        artistName: item.artistName,
        title: item.title,
        type: item.type,
        date: item.date,
      })),
    }),
  })
  const body = probe.ok ? await probe.json() : { blurbs: {} }
  for (const item of chunk) {
    if (!(blurbKey(item.slug, item.type, item.title) in (body.blurbs ?? {}))) {
      misses.push(item)
    }
  }
  await new Promise((r) => setTimeout(r, 300))
}
const seen = new Set()
const unique = misses.filter((item) => {
  const key = blurbKey(item.slug, item.type, item.title)
  if (seen.has(key)) return false
  seen.add(key)
  return true
})
console.log(
  JSON.stringify(
    unique.map((item) => ({
      key: blurbKey(item.slug, item.type, item.title),
      slug: item.slug,
      artistName: item.artistName,
      title: item.title,
      type: item.type,
      date: item.date,
    })),
    null,
    1,
  ),
)
