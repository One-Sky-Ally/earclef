import type { ListenContent } from '@/lib/types'
import { SectionHeader } from '@/components/SectionHeader'
import { LinkPills } from '@/components/LinkPills'
import { AlbumCard } from '@/components/AlbumCard'
import { CatalogLauncher } from '@/components/CatalogLauncher'
import styles from './Listen.module.css'

interface ListenProps {
  listen: ListenContent
  artistName: string
  mbid?: string
}

export function Listen({ listen, artistName, mbid }: ListenProps) {
  const bandcampUrl = listen.platforms.find(
    (p) => p.platform === 'bandcamp',
  )?.url
  const fallbackUrl =
    bandcampUrl ??
    listen.platforms.find((p) => p.platform === 'appleMusic')?.url ??
    listen.platforms[0]?.url
  const hasBandcamp = Boolean(bandcampUrl)

  return (
    <section id="listen" className="section" aria-labelledby="listen-heading">
      <div className="container">
        <SectionHeader number="01" title="Listen" headingId="listen-heading" />
        <LinkPills links={listen.platforms} ariaLabel="Streaming platforms" />
        {listen.featuredAlbums.length > 0 && (
          <div className={styles.embeds}>
            {listen.featuredAlbums.map((album) => (
              <AlbumCard
                key={album.title}
                album={album}
                artistName={artistName}
                hasBandcamp={hasBandcamp}
              />
            ))}
          </div>
        )}
        <CatalogLauncher
          artistName={artistName}
          mbid={mbid}
          fallbackUrl={fallbackUrl}
          hasBandcamp={hasBandcamp}
          className={styles.more}
        />
      </div>
    </section>
  )
}
