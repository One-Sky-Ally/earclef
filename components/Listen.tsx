import type { ListenContent } from '@/lib/types'
import type { ArtistServicePresence } from '@/lib/listen/services'
import { platformLabel } from '@/lib/platforms'
import { SectionHeader } from '@/components/SectionHeader'
import { LinkPills } from '@/components/LinkPills'
import { AlbumCard } from '@/components/AlbumCard'
import { CatalogLauncher } from '@/components/CatalogLauncher'
import { ServiceAbsenceNote } from '@/components/listen/ServiceAbsenceNote'
import { ServicePicker } from '@/components/listen/ServicePicker'
import styles from './Listen.module.css'

interface ListenProps {
  listen: ListenContent
  artistName: string
  mbid?: string
  presence: ArtistServicePresence
}

export function Listen({ listen, artistName, mbid, presence }: ListenProps) {
  const fallback =
    listen.platforms.find((p) => p.platform === 'bandcamp') ??
    listen.platforms.find((p) => p.platform === 'appleMusic') ??
    listen.platforms[0]
  const hasBandcamp = Boolean(presence.bandcampUrl)

  return (
    <section id="listen" className="section" aria-labelledby="listen-heading">
      <div className="container">
        <SectionHeader number="01" title="Listen" headingId="listen-heading" />
        <LinkPills links={listen.platforms} ariaLabel="Streaming platforms" />
        {/* The site hosts no music: album links go to the service the
            fan already pays for, chosen here and remembered site-wide. */}
        <div className={styles.pickerRow}>
          <ServicePicker />
        </div>
        <ServiceAbsenceNote presence={presence} />
        {listen.featuredAlbums.length > 0 && (
          <div className={styles.embeds}>
            {listen.featuredAlbums.map((album) => (
              <AlbumCard
                key={album.title}
                album={album}
                artistName={artistName}
                hasBandcamp={hasBandcamp}
                presence={presence}
              />
            ))}
          </div>
        )}
        <CatalogLauncher
          artistName={artistName}
          mbid={mbid}
          fallbackUrl={fallback?.url}
          fallbackLabel={fallback ? platformLabel(fallback.platform) : undefined}
          hasBandcamp={hasBandcamp}
          presence={presence}
          className={styles.more}
        />
      </div>
    </section>
  )
}
