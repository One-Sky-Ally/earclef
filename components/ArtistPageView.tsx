import type { ArtistContent } from '@/lib/types'
import { SiteNav } from '@/components/SiteNav'
import { Hero } from '@/components/Hero'
import { Listen } from '@/components/Listen'
import { Watch } from '@/components/Watch'
import { Story } from '@/components/Story'
import { Shows } from '@/components/Shows'
import { Merch } from '@/components/Merch'
import { Press } from '@/components/Press'
import { SiteFooter } from '@/components/SiteFooter'

interface ArtistPageViewProps {
  content: ArtistContent
  anchorBase: string
}

export function ArtistPageView({ content, anchorBase }: ArtistPageViewProps) {
  const youtubeChannelUrl =
    content.hero.socials.find((social) => social.platform === 'youtube')?.url ??
    (content.integrations.youtube.channelId
      ? `https://www.youtube.com/channel/${content.integrations.youtube.channelId}`
      : undefined)

  return (
    <>
      <SiteNav anchorBase={anchorBase} />
      <Hero hero={content.hero} />
      <main>
        {content.listen.enabled && (
          <Listen
            listen={content.listen}
            artistName={content.hero.name}
            mbid={content.integrations.setlistfm.mbid || undefined}
          />
        )}
        {content.watch.enabled && (
          <Watch
            watch={content.watch}
            artistName={content.hero.name}
            channelId={content.integrations.youtube.channelId || undefined}
            channelUrl={youtubeChannelUrl}
          />
        )}
        {content.story.enabled && <Story story={content.story} />}
        {content.shows.enabled && <Shows shows={content.shows} />}
        {content.merch.enabled && <Merch merch={content.merch} />}
        {content.press.enabled && (
          <Press press={content.press} artistName={content.hero.name} />
        )}
      </main>
      <SiteFooter footer={content.footer} />
    </>
  )
}
