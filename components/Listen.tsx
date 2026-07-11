import type { ListenContent } from '@/lib/types'
import { SectionHeader } from '@/components/SectionHeader'
import { LinkPills } from '@/components/LinkPills'
import { SpotifyEmbed } from '@/components/SpotifyEmbed'
import styles from './Listen.module.css'

interface ListenProps {
  listen: ListenContent
}

export function Listen({ listen }: ListenProps) {
  const catalogUrl =
    listen.platforms.find((p) => p.platform === 'spotify')?.url ??
    listen.platforms.find((p) => p.platform === 'bandcamp')?.url ??
    listen.platforms[0]?.url

  return (
    <section id="listen" className="section" aria-labelledby="listen-heading">
      <div className="container">
        <SectionHeader number="01" title="Listen" headingId="listen-heading" />
        <LinkPills links={listen.platforms} ariaLabel="Streaming platforms" />
        {listen.embeds.length > 0 && (
          <div className={styles.embeds}>
            {listen.embeds.map((embed) => (
              <SpotifyEmbed key={embed.id} embed={embed} />
            ))}
          </div>
        )}
        {catalogUrl && (
          <a
            className={styles.more}
            href={catalogUrl}
            target="_blank"
            rel="noreferrer"
          >
            View full catalog →
          </a>
        )}
      </div>
    </section>
  )
}
