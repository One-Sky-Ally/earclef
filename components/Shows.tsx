import type { ShowsContent } from '@/lib/types'
import { localIsoDate } from '@/lib/shows'
import { SectionHeader } from '@/components/SectionHeader'
import { SetlistFmLink } from '@/components/artist/SetlistFmLink'
import { ShowsTabs } from '@/components/artist/ShowsTabs'

interface ShowsProps {
  shows: ShowsContent
  artistName: string
  /** MusicBrainz id — finds the artist's own setlist.fm page. */
  mbid?: string
}

export function Shows({ shows, artistName, mbid }: ShowsProps) {
  return (
    <section id="shows" className="section" aria-labelledby="shows-heading">
      <div className="container">
        <SectionHeader number="04" title="Live & setlists" headingId="shows-heading" />
        <SetlistFmLink mbid={mbid} artistName={artistName} />
        <ShowsTabs shows={shows} artistName={artistName} builtOn={localIsoDate()} />
      </div>
    </section>
  )
}
