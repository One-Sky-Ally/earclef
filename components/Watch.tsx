import type { WatchContent } from '@/lib/types'
import { SectionHeader } from '@/components/SectionHeader'
import { YouTubeEmbed } from '@/components/YouTubeEmbed'
import styles from './Watch.module.css'

interface WatchProps {
  watch: WatchContent
  channelUrl?: string
}

export function Watch({ watch, channelUrl }: WatchProps) {
  const [featured, ...rest] = watch.videos

  return (
    <section id="watch" className="section" aria-labelledby="watch-heading">
      <div className="container">
        <SectionHeader number="02" title="Watch" headingId="watch-heading" />
        {featured && (
          <div className={styles.featured}>
            <YouTubeEmbed video={featured} index={1} />
          </div>
        )}
        {rest.length > 0 && (
          <div className={styles.grid}>
            {rest.map((video, i) => (
              <YouTubeEmbed key={video.youtubeId} video={video} index={i + 2} />
            ))}
          </div>
        )}
        {channelUrl && (
          <a
            className={styles.more}
            href={channelUrl}
            target="_blank"
            rel="noreferrer"
          >
            View all videos →
          </a>
        )}
      </div>
    </section>
  )
}
