import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { getAllArtists } from '@/lib/content'
import { SiteNav } from '@/components/SiteNav'
import { ArchiveArtist } from '@/components/archive/ArchiveArtist'

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export const metadata: Metadata = {
  title: 'Artist card — Ear Clef',
  description:
    'What verified sources record about an artist: where they are from, when they were active, and what they released.',
  // Deliberately not indexed. These cards are ASSEMBLED, not written —
  // letting thin auto-built pages compete in search with 130
  // hand-verified roster pages would devalue the ones that took the
  // work. Reversible if the owner ever wants them discoverable.
  robots: { index: false, follow: true },
}

/**
 * The archive card for an artist the site has no page for — the ones
 * the globe and the saved-songs playlist surface. Everything on it
 * comes from a source that can be checked; nothing on it is written.
 *
 * A rostered artist never lands here: they have a real page, and two
 * pages for one artist would split what the roster earned.
 */
export default async function ArchiveArtistPage({
  params,
}: {
  params: Promise<{ mbid: string }>
}) {
  const { mbid } = await params
  if (!UUID.test(mbid)) notFound()

  const rostered = getAllArtists().find(
    (artist) => artist.integrations.setlistfm.mbid === mbid,
  )
  if (rostered) redirect(`/${rostered.slug}`)

  return (
    <>
      <SiteNav showSections={false} />
      <ArchiveArtist mbid={mbid} />
    </>
  )
}
