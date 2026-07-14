/**
 * Native audio URL resolution. Files live at <base>/<slug>/<file>.
 * The base defaults to /audio (files in public/ — placeholder phase) and
 * moves to Cloudflare R2 by setting NEXT_PUBLIC_AUDIO_BASE at build time —
 * a one-variable swap, no code changes.
 */

const AUDIO_BASE = process.env.NEXT_PUBLIC_AUDIO_BASE ?? '/audio'

export function audioUrl(slug: string, file: string): string {
  return `${AUDIO_BASE}/${slug}/${encodeURIComponent(file)}`
}

export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds))
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
}
