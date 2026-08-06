import type { MetadataRoute } from 'next'
import { getAllArtists } from '@/lib/content'

const SITE = 'https://earclef.com'

/**
 * Built at deploy time, so every roster addition (a commit → rebuild)
 * lands in the sitemap automatically. Artist entries use their
 * validated canonical URLs from content JSON.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const mainPages: MetadataRoute.Sitemap = [
    { url: `${SITE}/`, changeFrequency: 'daily', priority: 1 },
    { url: `${SITE}/artists`, changeFrequency: 'daily', priority: 0.9 },
    { url: `${SITE}/feed`, changeFrequency: 'daily', priority: 0.9 },
    { url: `${SITE}/for-artists`, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${SITE}/manifesto`, changeFrequency: 'yearly', priority: 0.6 },
    { url: `${SITE}/suggest`, changeFrequency: 'yearly', priority: 0.4 },
    { url: `${SITE}/privacy`, changeFrequency: 'yearly', priority: 0.2 },
  ]

  const artistPages: MetadataRoute.Sitemap = getAllArtists().map(
    (artist) => ({
      url: artist.meta.canonicalUrl || `${SITE}/${artist.slug}`,
      changeFrequency: 'weekly',
      priority: 0.8,
    }),
  )

  return [...mainPages, ...artistPages]
}
