import type { MetadataRoute } from 'next'

/**
 * Crawlers are welcome everywhere public. The API and the owner studio
 * are blocked outright; /me and /fan stay crawlable ON PURPOSE — they
 * carry noindex metadata, and a robots block would keep crawlers from
 * ever seeing it.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/studio'],
    },
    sitemap: 'https://earclef.com/sitemap.xml',
  }
}
