import type { StoryContent } from '@/lib/types'
import { SectionHeader } from '@/components/SectionHeader'
import styles from './Story.module.css'

interface StoryProps {
  story: StoryContent
}

export function Story({ story }: StoryProps) {
  return (
    <section id="story" className="section" aria-labelledby="story-heading">
      <div className="container">
        <SectionHeader
          number="03"
          title={story.heading}
          headingId="story-heading"
        />
        <div className={styles.prose}>
          {story.paragraphs.map((paragraph) => (
            <p key={paragraph.slice(0, 40)}>{paragraph}</p>
          ))}
        </div>
        {story.pullQuote && story.pullQuote.text && (
          <blockquote className={styles.quote}>
            <p>{story.pullQuote.text}</p>
            {story.pullQuote.attribution && (
              <cite>{story.pullQuote.attribution}</cite>
            )}
          </blockquote>
        )}
      </div>
    </section>
  )
}
