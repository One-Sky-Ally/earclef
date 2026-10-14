import type { ListenContent } from '@/lib/types'
import type { ArtistServicePresence } from '@/lib/listen/services'
import { platformLabel } from '@/lib/platforms'
import { SectionHeader } from '@/components/SectionHeader'
import { LinkPills } from '@/components/LinkPills'
import { AlbumCard } from '@/components/AlbumCard'
import { CatalogLauncher } from '@/components/CatalogLauncher'
import { ServiceAbsenceNote } from '@/components/listen/ServiceAbsenceNote'
import { ServicePicker } from '@/components/listen/ServicePicker'
import { StartHere, type StartHereTrack } from '@/components/artist/StartHere'
import { Discography } from '@/components/artist/Discography'
import styles from './Listen.module.css'

interface ListenProps {
  listen: ListenContent
  artistName: string
  mbid?: string
  presence: ArtistServicePresence
  /** Songs that play here: hand-picked videos, then other verified songs. */
  startHere?: StartHereTrack[]
}

export function Listen({ listen, artistName, mbid, presence, startHere = [] }: ListenProps) {
  const fallback =
    listen.platforms.find((p) => p.platform === 'bandcamp') ??
    listen.platforms.find((p) => p.platform === 'appleMusic') ??
    listen.platforms[0]
  const hasBandcamp = Boolean(presence.bandcampUrl)

  return (
    <section id="listen" className="section" aria-labelledby="listen-heading">
      <div className="container">
        <div className={styles.header}>
          <SectionHeader
            title={startHere.length > 0 ? 'Start here' : 'Music'}
            headingId="listen-heading"
            subtitle={
              startHere.length > 0
                ? `${startHere.length} song${startHere.length === 1 ? '' : 's'} to begin with ${artistName} — every one plays here.`
                : `Where to hear ${artistName}. Ear Clef hosts no music — links open on the service you choose.`
            }
          />
          {/* The site hosts no music: album links go to the service the
              fan already pays for, chosen here and remembered site-wide.
              The artist's own service pages wait in a closed accordion. */}
          <div className={styles.pickerRow}>
            <ServicePicker />
            {listen.platforms.length > 0 && (
              <details className={styles.platforms}>
                <summary className={styles.platformsSummary}>
                  {artistName} on streaming services
                  <span aria-hidden="true" className={styles.chevron}>
                    ▾
                  </span>
                </summary>
                <div className={styles.platformsBody}>
                  <LinkPills links={listen.platforms} ariaLabel="Streaming platforms" />
                </div>
              </details>
            )}
          </div>
        </div>
        <ServiceAbsenceNote presence={presence} />
        {startHere.length > 0 && (
          <StartHere artistName={artistName} mbid={mbid} tracks={startHere} />
        )}
        {mbid ? (
          <Discography
            mbid={mbid}
            artistName={artistName}
            presence={presence}
            hasBandcamp={hasBandcamp}
          />
        ) : (
          <>
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
          </>
        )}
      </div>
    </section>
  )
}
