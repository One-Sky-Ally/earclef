import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ArtistContent } from '@/lib/types'

const CONTENT_DIR = join(process.cwd(), 'content')
const SLUG_PATTERN = /^[a-z0-9-]+$/

export function getAllArtists(): ArtistContent[] {
  return readdirSync(CONTENT_DIR)
    .filter((file) => file.endsWith('.json'))
    .map(
      (file) =>
        JSON.parse(
          readFileSync(join(CONTENT_DIR, file), 'utf8'),
        ) as ArtistContent,
    )
    .sort((a, b) => a.hero.name.localeCompare(b.hero.name))
}

export function getArtistBySlug(slug: string): ArtistContent | undefined {
  if (!SLUG_PATTERN.test(slug)) return undefined
  try {
    return JSON.parse(
      readFileSync(join(CONTENT_DIR, `${slug}.json`), 'utf8'),
    ) as ArtistContent
  } catch {
    return undefined
  }
}
