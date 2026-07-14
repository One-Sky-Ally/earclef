import { NextResponse } from 'next/server'
import { isOwner, unauthorized } from '@/lib/curation/auth'
import { isArtistTier } from '@/lib/tiers'
import roster from '@/lib/discover/roster.json'

/**
 * Retier an artist by committing the edited content JSON straight to
 * GitHub — git stays the single source of truth and Netlify's auto-deploy
 * applies the change (~1 min). Refuses to write unless the file
 * round-trips byte-identically through parse/serialize, so a commit can
 * never reformat a content file.
 */

const REPO = 'One-Sky-Ally/earclef'
const BRANCH = 'main'

const KNOWN_SLUGS = new Set(roster.map((artist) => artist.slug))

function json(body: unknown, status = 200): NextResponse {
  const response = NextResponse.json(body, { status })
  response.headers.set('Cache-Control', 'no-store')
  return response
}

function githubHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

export async function POST(request: Request) {
  if (!isOwner(request)) return unauthorized()

  const token = process.env.GITHUB_CONTENT_TOKEN
  if (!token) {
    return json(
      {
        error:
          'Retier is not configured — add a GITHUB_CONTENT_TOKEN with contents-write access to the Netlify environment.',
      },
      501,
    )
  }

  let body: { slug?: string; tier?: string }
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }
  const { slug, tier } = body
  if (!slug || !KNOWN_SLUGS.has(slug)) {
    return json({ error: 'Unknown artist slug' }, 400)
  }
  if (!isArtistTier(tier)) {
    return json({ error: 'Invalid tier' }, 400)
  }

  const path = `content/${slug}.json`
  const contentsUrl = `https://api.github.com/repos/${REPO}/contents/${path}?ref=${BRANCH}`

  try {
    const current = await fetch(contentsUrl, {
      headers: githubHeaders(token),
      cache: 'no-store',
    })
    if (!current.ok) {
      return json({ error: `GitHub read failed (${current.status})` }, 502)
    }
    const file = (await current.json()) as { content: string; sha: string }
    const original = Buffer.from(file.content, 'base64').toString('utf8')

    const artist = JSON.parse(original) as Record<string, unknown>
    const serialize = (value: unknown) => JSON.stringify(value, null, 2) + '\n'

    // Never commit a reformat: the untouched parse/serialize round-trip
    // must reproduce the file byte-for-byte before we change anything.
    if (serialize(artist) !== original) {
      return json(
        { error: `${path} does not round-trip cleanly — edit it in a session instead` },
        409,
      )
    }
    if (artist.tier === tier) {
      return json({ ok: true, unchanged: true })
    }

    artist.tier = tier
    const put = await fetch(
      `https://api.github.com/repos/${REPO}/contents/${path}`,
      {
        method: 'PUT',
        headers: githubHeaders(token),
        body: JSON.stringify({
          message: `chore: retier ${slug} → ${tier}`,
          content: Buffer.from(serialize(artist), 'utf8').toString('base64'),
          sha: file.sha,
          branch: BRANCH,
        }),
      },
    )
    if (!put.ok) {
      const detail = await put.text()
      console.error(`retier PUT failed (${put.status}):`, detail.slice(0, 300))
      return json({ error: `GitHub commit failed (${put.status})` }, 502)
    }
    const result = (await put.json()) as { commit?: { sha?: string } }
    return json({ ok: true, commit: result.commit?.sha })
  } catch (error) {
    console.error('retier failed:', error)
    return json({ error: 'Retier failed' }, 502)
  }
}
