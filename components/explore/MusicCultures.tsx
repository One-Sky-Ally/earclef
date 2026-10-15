'use client'

import type { Culture } from '@/lib/explore/cultureTypes'
import { CultureCard } from '@/components/explore/CultureCard'
import { ScrollRow } from '@/components/ui/ScrollRow'

/**
 * The "Music cultures" row: Ear Clef picks, each anchored in a place,
 * an era or a sound. "See all" opens the full collection at /cultures.
 */

interface MusicCulturesProps {
  cultures: Culture[]
  currentId?: string | null
  onSelect: (culture: Culture) => void
}

export function MusicCultures({ cultures, currentId, onSelect }: MusicCulturesProps) {
  return (
    <ScrollRow
      id="music-cultures"
      title="Music cultures"
      seeAll={{ href: '/cultures' }}
      note="Ear Clef picks — documented eras, places by the decade, and songs about places. Every song in them plays here."
      items={cultures.map((culture) => ({
        key: culture.id,
        node: (
          <CultureCard
            culture={culture}
            current={culture.id === currentId}
            onSelect={onSelect}
          />
        ),
      }))}
    />
  )
}
