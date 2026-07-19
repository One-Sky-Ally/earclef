import { NextResponse } from 'next/server'
import { isGenreLens } from '@/lib/explore/genreData'
import stories from '@/lib/explore/genre-stories.json'

/**
 * Genre origin-and-spread stories — SERVED FROM THE COMMITTED FILE ONLY.
 * Generation happens locally in Claude Code (on the owner's plan) and the
 * result is committed to lib/explore/genre-stories.json; this route never
 * calls a model. To add a genre: generate the story locally (see the
 * /add-artist command doc for the local-generation pattern) and commit it.
 */

interface StoryRecord {
  story: string
  model: string
  at: string
}

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ genre: string }> },
) {
  const { genre: raw } = await ctx.params
  const genre = decodeURIComponent(raw)
  if (!isGenreLens(genre)) {
    return NextResponse.json({ error: 'Unknown genre' }, { status: 404 })
  }

  const record = (stories as Record<string, StoryRecord>)[genre]
  if (!record) {
    // A lens without a committed story hides its card client-side.
    return NextResponse.json({ error: 'Story unavailable' }, { status: 404 })
  }

  const response = NextResponse.json(record)
  response.headers.set(
    'Cache-Control',
    'public, s-maxage=2592000, stale-while-revalidate=604800',
  )
  return response
}
