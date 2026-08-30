import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Metadata } from 'next'
import type { ArtistContent } from '@/lib/types'

function isValidUrl(value: string): boolean {
  return value.startsWith('https://') || value.startsWith('http://')
}

/**
 * Does `meta.ogImage` point at something that actually exists?
 *
 * All 131 artists carried `/images/og-<slug>.jpg` and not one of those
 * files was ever created, so naming them here produced 131 broken link
 * previews. Existence is now the bar, not plausibility: an absolute
 * URL is a destination someone chose deliberately, and a site-relative
 * path counts only when the file is really in public/. Everything else
 * falls through to the card generated per artist in
 * app/[slug]/opengraph-image.tsx.
 *
 * Server-only: buildMetadata is called from generateMetadata alone,
 * and every artist page is statically generated, so this runs at build
 * time and never ships to a client bundle.
 */
function imageExists(value: string): boolean {
  if (!value) return false
  if (isValidUrl(value)) return true
  if (!value.startsWith('/')) return false
  return existsSync(join(process.cwd(), 'public', value))
}

const SITE_ORIGIN = 'https://earclef.com'

export function buildMetadata(content: ArtistContent): Metadata {
  const { meta, hero } = content
  const canonical = isValidUrl(meta.canonicalUrl) ? meta.canonicalUrl : undefined

  return {
    title: meta.title,
    description: meta.description,
    metadataBase: new URL(SITE_ORIGIN),
    ...(canonical && {
      alternates: { canonical },
    }),
    openGraph: {
      title: meta.title,
      description: meta.description,
      siteName: 'Ear Clef',
      type: 'profile',
      // Only a REAL destination may override the generated card —
      // naming a file here beats the opengraph-image convention, which
      // is how 131 broken previews shipped. Aplete's own photo, wired
      // up deliberately in 3d0cd75, still wins; the rest fall through.
      ...(imageExists(meta.ogImage) && {
        images: [{ url: meta.ogImage, alt: hero.name }],
      }),
    },
    twitter: {
      card: 'summary_large_image',
      title: meta.title,
      description: meta.description,
    },
  }
}
