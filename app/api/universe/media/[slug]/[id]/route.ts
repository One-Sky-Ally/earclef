import { getArtistBySlug } from '@/lib/content'
import { readMedia } from '@/lib/membership/posts'
import { activeMember } from '@/lib/membership/session'

/**
 * Members-only media, streamed from the universe store. Range requests
 * are honored from the in-memory buffer because Safari refuses to play
 * <audio> from endpoints that ignore them.
 */

const ID_PATTERN = /^[a-z0-9-]+$/

export async function GET(
  request: Request,
  ctx: { params: Promise<{ slug: string; id: string }> },
) {
  const { slug, id } = await ctx.params
  if (!ID_PATTERN.test(id)) {
    return Response.json({ error: 'Bad media id' }, { status: 400 })
  }
  const content = getArtistBySlug(slug)
  if (!content?.membership?.enabled) {
    return Response.json({ error: 'No membership here' }, { status: 404 })
  }
  if (!(await activeMember(request, slug))) {
    return Response.json({ error: 'Members only' }, { status: 401 })
  }

  const media = await readMedia(slug, id)
  if (!media) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  const bytes = media.data.byteLength
  const baseHeaders = {
    'Content-Type': media.contentType,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, no-store',
  }

  const range = request.headers.get('range')
  const match = range?.match(/^bytes=(\d*)-(\d*)$/)
  if (match && (match[1] || match[2])) {
    const start = match[1] ? Number(match[1]) : bytes - Number(match[2])
    const end = match[1] && match[2] ? Number(match[2]) : bytes - 1
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end >= bytes ||
      start > end
    ) {
      return new Response(null, {
        status: 416,
        headers: { ...baseHeaders, 'Content-Range': `bytes */${bytes}` },
      })
    }
    return new Response(media.data.slice(start, end + 1), {
      status: 206,
      headers: {
        ...baseHeaders,
        'Content-Range': `bytes ${start}-${end}/${bytes}`,
        'Content-Length': String(end - start + 1),
      },
    })
  }

  return new Response(media.data, {
    status: 200,
    headers: { ...baseHeaders, 'Content-Length': String(bytes) },
  })
}
