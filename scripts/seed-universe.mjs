/**
 * Seed the Aplete Universe with one labeled PLACEHOLDER post per kind so
 * the gated loop is demonstrable end-to-end. Idempotent-ish: skips any
 * kind that already has a post whose title starts with "Placeholder".
 *
 *   OWNER_KEY=... node scripts/seed-universe.mjs [baseUrl]
 *
 * Reads OWNER_KEY from the environment or .env.local. Point baseUrl at
 * production to seed there (default http://localhost:3000).
 */
import { readFileSync } from 'node:fs'

const SLUG = 'aplete'
const base = process.argv[2] ?? 'http://localhost:3000'

function ownerKey() {
  if (process.env.OWNER_KEY) return process.env.OWNER_KEY
  try {
    const match = readFileSync('.env.local', 'utf8').match(/^OWNER_KEY=(.+)$/m)
    if (match) return match[1].trim()
  } catch {
    // fall through
  }
  throw new Error('OWNER_KEY not found (env or .env.local)')
}

const key = ownerKey()
const headers = { 'Content-Type': 'application/json', 'x-owner-key': key }

const SEED_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 400">
  <rect width="640" height="400" fill="#161210"/>
  <circle cx="320" cy="200" r="150" fill="none" stroke="#f2a93b" stroke-width="1.5" opacity="0.7"/>
  <circle cx="320" cy="200" r="105" fill="none" stroke="#f2a93b" stroke-width="1" opacity="0.45"/>
  <circle cx="320" cy="200" r="60" fill="none" stroke="#f2a93b" stroke-width="0.8" opacity="0.3"/>
  <circle cx="320" cy="200" r="16" fill="#f2a93b"/>
  <text x="320" y="365" text-anchor="middle" fill="#a89f92" font-family="Georgia, serif" font-style="italic" font-size="18">placeholder — real art incoming</text>
</svg>`

const POSTS = [
  {
    post: {
      kind: 'text',
      title: 'Placeholder — a note from inside the universe',
      body: 'EDIT-ME: this is where Stefano writes the first real members-only post — a thought, a work-in-progress, a piece of the world nobody outside sees yet.\n\nThis placeholder exists so the gated loop can be tested end to end. Replace it from the Curation Studio.',
    },
  },
  {
    post: {
      kind: 'image',
      title: 'Placeholder — sketch of the week',
      body: 'A stand-in frame until real art lands here.',
      alt: 'Concentric gold rings on a dark background, labeled placeholder',
    },
    media: {
      filename: 'placeholder-rings.svg',
      contentType: 'image/svg+xml',
      dataBase64: Buffer.from(SEED_SVG).toString('base64'),
    },
  },
  {
    post: {
      kind: 'audio',
      title: 'Placeholder — tone sketch (members preview)',
      body: 'A 20-second placeholder tone standing in for the first members-only recording.',
      duration: 20,
    },
    media: {
      filename: 'placeholder-tone.m4a',
      contentType: 'audio/mp4',
      dataBase64: readFileSync(
        'public/audio/trust-in-the-sun/01-placeholder-first-light.m4a',
      ).toString('base64'),
    },
  },
]

const existingRes = await fetch(`${base}/api/studio/universe?slug=${SLUG}`, {
  headers: { 'x-owner-key': key },
})
if (!existingRes.ok) {
  throw new Error(`Could not read current posts: HTTP ${existingRes.status}`)
}
const { posts: existing } = await existingRes.json()

for (const seed of POSTS) {
  const already = existing.some(
    (post) =>
      post.kind === seed.post.kind && post.title.startsWith('Placeholder'),
  )
  if (already) {
    console.log(`skip ${seed.post.kind}: placeholder already present`)
    continue
  }
  const res = await fetch(`${base}/api/studio/universe`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ action: 'addPost', slug: SLUG, ...seed }),
  })
  const body = await res.json()
  if (!res.ok) {
    throw new Error(`${seed.post.kind} failed: ${body.error ?? res.status}`)
  }
  console.log(`seeded ${seed.post.kind}: "${seed.post.title}"`)
}
console.log('done')
