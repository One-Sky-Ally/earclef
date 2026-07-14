import type { UniverseMedia, UniversePostKind } from '@/lib/membership/types'

/** Media lives behind the member gate; posts reference it by API URL. */
export function mediaUrl(slug: string, media: UniverseMedia): string {
  return `/api/universe/media/${slug}/${media.id}`
}

export const KIND_LABELS: Record<UniversePostKind, string> = {
  text: 'Words',
  image: 'Image',
  audio: 'Sound',
}

/** ISO date → "July 14, 2026" without timezone drift on date-only strings. */
export function formatPostDate(iso: string): string {
  const date = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}
