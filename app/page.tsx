import { artistContent } from '@/lib/content'
import { buildMetadata } from '@/lib/metadata'
import { SiteNav } from '@/components/SiteNav'
import { Hero } from '@/components/Hero'
import { Listen } from '@/components/Listen'
import { Watch } from '@/components/Watch'
import { Story } from '@/components/Story'
import { Shows } from '@/components/Shows'
import { Merch } from '@/components/Merch'
import { Press } from '@/components/Press'
import { SiteFooter } from '@/components/SiteFooter'

export const metadata = buildMetadata(artistContent)

export default function ArtistPage() {
  const content = artistContent

  return (
    <>
      <SiteNav />
      <Hero hero={content.hero} />
      <main>
        {content.listen.enabled && <Listen listen={content.listen} />}
        {content.watch.enabled && <Watch watch={content.watch} />}
        {content.story.enabled && <Story story={content.story} />}
        {content.shows.enabled && <Shows shows={content.shows} />}
        {content.merch.enabled && <Merch merch={content.merch} />}
        {content.press.enabled && <Press press={content.press} />}
      </main>
      <SiteFooter footer={content.footer} />
    </>
  )
}
