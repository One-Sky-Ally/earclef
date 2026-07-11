import { notFound } from 'next/navigation'
import { getAllArtists, getArtistBySlug } from '@/lib/content'
import { buildMetadata } from '@/lib/metadata'
import { ArtistPageView } from '@/components/ArtistPageView'

export const dynamicParams = false

export function generateStaticParams() {
  return getAllArtists().map((artist) => ({ slug: artist.slug }))
}

export async function generateMetadata(ctx: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await ctx.params
  const content = getArtistBySlug(slug)
  return content ? buildMetadata(content) : {}
}

export default async function ArtistPage(ctx: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await ctx.params
  const content = getArtistBySlug(slug)
  if (!content) notFound()
  return <ArtistPageView content={content} anchorBase={`/${slug}`} />
}
