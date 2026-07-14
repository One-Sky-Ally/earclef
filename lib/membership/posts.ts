/**
 * The Universe feed — members-only posts and their media, in the
 * "universe" Blobs store. Post bodies and media are NEVER in the public
 * bundle or the git repo; the static page ships only with teasers fetched
 * at runtime. Dev fallback mirrors the members store pattern.
 */
import { getStore } from '@netlify/blobs'
import type { UniversePost } from './types'

/** Raw uploads are capped so studio payloads stay inside function limits. */
export const MEDIA_MAX_BYTES = 4 * 1024 * 1024

interface DevMedia {
  data: ArrayBuffer
  contentType: string
}

let devPosts = new Map<string, UniversePost[]>()
let devMedia = new Map<string, DevMedia>()

function store() {
  return getStore({ name: 'universe', consistency: 'strong' })
}

const postsKey = (slug: string) => `${slug}/posts`
const mediaKey = (slug: string, id: string) => `${slug}/media/${id}`

export async function readPosts(slug: string): Promise<UniversePost[]> {
  try {
    return ((await store().get(postsKey(slug), { type: 'json' })) ??
      []) as UniversePost[]
  } catch {
    return devPosts.get(slug) ?? []
  }
}

async function writePosts(
  slug: string,
  posts: UniversePost[],
): Promise<void> {
  try {
    await store().setJSON(postsKey(slug), posts)
  } catch {
    devPosts = new Map(devPosts).set(slug, posts)
  }
}

/** Newest first. Returns the updated feed. */
export async function addPost(
  slug: string,
  post: UniversePost,
  media?: { data: ArrayBuffer; contentType: string },
): Promise<UniversePost[]> {
  if (media && post.media) {
    try {
      await store().set(mediaKey(slug, post.media.id), media.data, {
        metadata: { contentType: media.contentType },
      })
    } catch {
      devMedia = new Map(devMedia).set(mediaKey(slug, post.media.id), {
        data: media.data,
        contentType: media.contentType,
      })
    }
  }
  const next = [post, ...(await readPosts(slug))]
  await writePosts(slug, next)
  return next
}

/** Removes the post and its media blob. Returns the updated feed. */
export async function removePost(
  slug: string,
  id: string,
): Promise<UniversePost[]> {
  const posts = await readPosts(slug)
  const target = posts.find((post) => post.id === id)
  const next = posts.filter((post) => post.id !== id)
  if (target) await writePosts(slug, next)
  if (target?.media) {
    try {
      await store().delete(mediaKey(slug, target.media.id))
    } catch {
      const cleaned = new Map(devMedia)
      cleaned.delete(mediaKey(slug, target.media.id))
      devMedia = cleaned
    }
  }
  return next
}

export async function readMedia(
  slug: string,
  id: string,
): Promise<DevMedia | null> {
  try {
    const blob = await store().getWithMetadata(mediaKey(slug, id), {
      type: 'arrayBuffer',
    })
    if (!blob || !blob.data) return null
    return {
      data: blob.data,
      contentType:
        (blob.metadata?.contentType as string) ?? 'application/octet-stream',
    }
  } catch {
    return devMedia.get(mediaKey(slug, id)) ?? null
  }
}
