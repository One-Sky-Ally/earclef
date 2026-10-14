import type { WatchContent } from '@/lib/types'
import { SectionHeader } from '@/components/SectionHeader'
import { VideoExplorer } from '@/components/artist/VideoExplorer'

interface WatchProps {
  watch: WatchContent
  artistName: string
  channelId?: string
  channelUrl?: string
}

export function Watch({ watch, artistName, channelId, channelUrl }: WatchProps) {
  return (
    <section id="watch" className="section" aria-labelledby="watch-heading">
      <div className="container">
        <SectionHeader
          title="Video explorer"
          headingId="watch-heading"
          subtitle={`Hand-picked videos and uploads from ${artistName}’s own YouTube channel.`}
        />
        <VideoExplorer
          artistName={artistName}
          picks={watch.videos}
          channelId={channelId}
          channelUrl={channelUrl}
        />
      </div>
    </section>
  )
}
