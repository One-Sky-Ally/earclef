import { getArtistBySlug } from '@/lib/content'
import { buildMetadata } from '@/lib/metadata'
import { ArtistPageView } from '@/components/ArtistPageView'

function requireRadiohead() {
  const artist = getArtistBySlug('radiohead')
  if (!artist) throw new Error('content/radiohead.json is missing')
  return artist
}

const content = requireRadiohead()

export const metadata = buildMetadata(content)

export default function HomePage() {
  return <ArtistPageView content={content} anchorBase="/" />
}
