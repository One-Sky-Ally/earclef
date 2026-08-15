import type { Metadata } from 'next'
import type { ArtistContent } from '@/lib/types'

function isValidUrl(value: string): boolean {
  return value.startsWith('https://') || value.startsWith('http://')
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
      images: [{ url: meta.ogImage, alt: hero.name }],
    },
    twitter: {
      card: 'summary_large_image',
      title: meta.title,
      description: meta.description,
    },
  }
}
