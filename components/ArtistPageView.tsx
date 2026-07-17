import type { ArtistContent } from '@/lib/types'
import { presenceFromContent } from '@/lib/listen/services'
import { SiteNav } from '@/components/SiteNav'
import { Hero } from '@/components/Hero'
import { PlaySection } from '@/components/PlaySection'
import { Listen } from '@/components/Listen'
import { Watch } from '@/components/Watch'
import { Story } from '@/components/Story'
import { Shows } from '@/components/Shows'
import { Merch } from '@/components/Merch'
import { Press } from '@/components/Press'
import { UniverseSection } from '@/components/universe/UniverseSection'
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
      <SiteNav
        anchorBase={anchorBase}
        includePlay={Boolean(content.play?.enabled)}
        universeLabel={
          content.membership?.enabled
            ? content.membership.perkTitle
            : undefined
        }
      />
      <Hero
        hero={content.hero}
        paletteVideoId={
          content.watch.enabled ? content.watch.videos[0]?.youtubeId : undefined
        }
        followSlug={content.slug}
      />
      <main>
        {content.play?.enabled && (
          <PlaySection
            play={content.play}
            artistName={content.hero.name}
            slug={content.slug}
          />
        )}
        {content.listen.enabled && (
          <Listen
            listen={content.listen}
            artistName={content.hero.name}
            mbid={content.integrations.setlistfm.mbid || undefined}
            presence={presenceFromContent(content)}
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
        {content.membership?.enabled && (
          <UniverseSection
            slug={content.slug}
            artistName={content.hero.name}
            membership={content.membership}
          />
        )}
      </main>
      <SiteFooter footer={content.footer} />
    </>
  )
}
