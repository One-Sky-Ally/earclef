import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getArtistBySlug } from '@/lib/content'
import { isOwner, unauthorized } from '@/lib/curation/auth'
import {
  MEDIA_MAX_BYTES,
  addPost,
  readPosts,
  removePost,
} from '@/lib/membership/posts'
import { deleteMember, getMember, listMembers, putMember } from '@/lib/membership/store'
import {
  EMAIL_PATTERN,
  extendMembership,
  normalizeEmail,
  type UniversePost,
  type UniversePostKind,
} from '@/lib/membership/types'

/**
 * Owner tools for the Universe: publish/remove posts and grant/revoke
 * comp memberships (gift years — also how the loop gets tested before
 * Stripe keys exist). Same owner gate as every write endpoint.
 */

const KINDS: UniversePostKind[] = ['text', 'image', 'audio']
const MEDIA_TYPES = new Set([
  'audio/mp4',
  'audio/mpeg',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/svg+xml',
])

function noStore(body: unknown, status = 200): NextResponse {
  const response = NextResponse.json(body, { status })
  response.headers.set('Cache-Control', 'no-store')
  return response
}

interface UniverseAction {
  action?: 'addPost' | 'removePost' | 'grant' | 'revoke'
  slug?: string
  id?: string
  email?: string
  post?: {
    kind?: UniversePostKind
    title?: string
    body?: string
    alt?: string
    duration?: number
  }
  media?: { filename?: string; contentType?: string; dataBase64?: string }
}

export async function GET(request: Request) {
  if (!isOwner(request)) return unauthorized()
  const slug = new URL(request.url).searchParams.get('slug') ?? ''
  if (!getArtistBySlug(slug)?.membership?.enabled) {
    return noStore({ error: 'No membership here' }, 404)
  }
  return noStore({
    posts: await readPosts(slug),
    members: await listMembers(slug),
  })
}

export async function POST(request: Request) {
  if (!isOwner(request)) return unauthorized()

  let body: UniverseAction
  try {
    body = await request.json()
  } catch {
    return noStore({ error: 'Invalid JSON body' }, 400)
  }

  const slug = body.slug ?? ''
  if (!getArtistBySlug(slug)?.membership?.enabled) {
    return noStore({ error: 'No membership here' }, 404)
  }

  switch (body.action) {
    case 'addPost':
      return handleAddPost(slug, body)
    case 'removePost': {
      if (!body.id) return noStore({ error: 'id required' }, 400)
      return noStore({ posts: await removePost(slug, body.id) })
    }
    case 'grant': {
      const email = normalizeEmail(body.email ?? '')
      if (!EMAIL_PATTERN.test(email)) {
        return noStore({ error: 'A valid email is required' }, 400)
      }
      await putMember(
        extendMembership(await getMember(slug, email), {
          email,
          artistSlug: slug,
          source: 'comp',
        }),
      )
      return noStore({ members: await listMembers(slug) })
    }
    case 'revoke': {
      const email = normalizeEmail(body.email ?? '')
      if (!EMAIL_PATTERN.test(email)) {
        return noStore({ error: 'A valid email is required' }, 400)
      }
      await deleteMember(slug, email)
      return noStore({ members: await listMembers(slug) })
    }
    default:
      return noStore({ error: 'Unknown action' }, 400)
  }
}

async function handleAddPost(slug: string, body: UniverseAction) {
  const kind = body.post?.kind
  const title = body.post?.title?.toString().trim()
  if (!kind || !KINDS.includes(kind) || !title || title.length > 200) {
    return noStore({ error: 'A kind and a title (≤200 chars) are required' }, 400)
  }

  const needsMedia = kind !== 'text'
  let media: { data: ArrayBuffer; contentType: string } | undefined
  let mediaRef: UniversePost['media']

  if (needsMedia) {
    const contentType = body.media?.contentType ?? ''
    const dataBase64 = body.media?.dataBase64 ?? ''
    if (!MEDIA_TYPES.has(contentType) || !dataBase64) {
      return noStore({ error: `${kind} posts need an allowed media upload` }, 400)
    }
    const buffer = Buffer.from(dataBase64, 'base64')
    if (buffer.byteLength === 0 || buffer.byteLength > MEDIA_MAX_BYTES) {
      return noStore(
        { error: `Media must be 1 byte – ${MEDIA_MAX_BYTES / 1024 / 1024} MB` },
        400,
      )
    }
    const wrongFamily =
      (kind === 'audio' && !contentType.startsWith('audio/')) ||
      (kind === 'image' && !contentType.startsWith('image/'))
    if (wrongFamily) {
      return noStore({ error: `Media type ${contentType} does not fit ${kind}` }, 400)
    }
    media = {
      data: buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      ),
      contentType,
    }
    mediaRef = {
      id: randomUUID(),
      contentType,
      filename: (body.media?.filename ?? 'upload').slice(0, 120),
      duration:
        typeof body.post?.duration === 'number' && body.post.duration > 0
          ? Math.round(body.post.duration)
          : undefined,
    }
  }

  const post: UniversePost = {
    id: randomUUID(),
    createdAt: new Date().toISOString().slice(0, 10),
    kind,
    title,
    body: body.post?.body?.toString().slice(0, 5000) || undefined,
    media: mediaRef,
    alt: kind === 'image' ? body.post?.alt?.toString().slice(0, 300) : undefined,
  }

  return noStore({ posts: await addPost(slug, post, media) })
}
