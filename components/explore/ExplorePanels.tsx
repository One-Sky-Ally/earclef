'use client'

import { useEffect, useRef, type ReactNode, type RefObject } from 'react'
import { panelFrames, type FrameRole } from '@/lib/explore/panelFrames'
import type { PlayingPlace } from '@/lib/explore/globePins'
import { journeySpan, type Culture } from '@/lib/explore/cultureTypes'
import type { GenreLens } from '@/lib/explore/genreData'
import type { SelectedArtist } from '@/components/explore/ArtistEraPanel'
import type { SelectedCountry } from '@/components/explore/CountryPanel'
import styles from './ExplorePanels.module.css'

/**
 * Music keeps playing while you keep exploring (owner, Nov 19 2026).
 *
 * The panel column holds up to two panels (lib/explore/panelFrames.ts):
 * the one whose music is on, kept MOUNTED and shrunk to its player
 * under a "Now playing" bar, and the one you are looking at. Nothing is
 * lifted out of the panels. The playing panel keeps its own queue, widen
 * reach and filters because it never unmounts. The YouTube iframe keeps
 * playing because its DOM node never moves.
 *
 * A panel counts as playing when any player inside it marks itself
 * data-playing="true" (QueuePlayer, YouTubeEmbed, JourneyPanel); a player
 * paused because another started marks itself "paused" (lib/play/oneSound.ts)
 * and never makes its panel the playing one. Pressing
 * play on the panel you are looking at makes it the playing one, and the
 * old one is unmounted, which stops it. Browsing alone never does.
 */

export type ExplorePanel =
  | { kind: 'artist'; artist: SelectedArtist; year: number }
  | { kind: 'country'; country: SelectedCountry; year: number; lens: GenreLens | null }
  | { kind: 'journey'; culture: Culture }
  | { kind: 'empty' }

export function panelKey(panel: ExplorePanel): string {
  switch (panel.kind) {
    case 'artist':
      return `a:${panel.artist.mbid}:${panel.year}`
    case 'country':
      return `${panel.country.code}:${panel.year}:${panel.lens ?? ''}`
    case 'journey':
      return `j:${panel.culture.id}`
    default:
      return 'empty'
  }
}

/** "Egypt 1966", "Egypt 1966 · Reggae", "Jamaica 1968–1972", "Songs about Paris". */
export function panelLabel(panel: ExplorePanel): string {
  switch (panel.kind) {
    case 'artist':
      return panel.artist.name
    case 'country':
      return `${panel.country.name} ${panel.year}${panel.lens ? ` · ${panel.lens}` : ''}`
    case 'journey':
      return panel.culture.kind === 'songs'
        ? `Songs about ${panel.culture.place}`
        : `${panel.culture.place} ${journeySpan(panel.culture)}`
    default:
      return ''
  }
}

/** Where a playing panel's music comes from, for the globe's ♪ mark. */
export function panelPlace(panel: ExplorePanel): PlayingPlace | null {
  switch (panel.kind) {
    case 'country':
      return { code: panel.country.code, label: panelLabel(panel) }
    case 'journey':
      return { code: panel.culture.code, label: panelLabel(panel) }
    default:
      // Artist panels link out; they never play on the page.
      return null
  }
}

interface ExplorePanelsProps {
  browse: ExplorePanel
  playing: ExplorePanel | null
  /** The panel you are looking at started playing: it becomes the playing one. */
  onPlay: (panel: ExplorePanel) => void
  onStop: () => void
  /** Go back to the playing place: look at it again, full size. */
  onOpen: (panel: ExplorePanel) => void
  renderPanel: (panel: ExplorePanel, role: FrameRole) => ReactNode
  /** The browsed panel's frame — where a stacked layout scrolls on open. */
  browseFrameRef: RefObject<HTMLDivElement | null>
  /** The playing panel's frame — where the phone's "Playing" chip scrolls. */
  nowFrameRef: RefObject<HTMLDivElement | null>
}

export function ExplorePanels({
  browse,
  playing,
  onPlay,
  onStop,
  onOpen,
  renderPanel,
  browseFrameRef,
  nowFrameRef,
}: ExplorePanelsProps) {
  const browseKey = panelKey(browse)
  const frames = panelFrames(
    playing ? { key: panelKey(playing), panel: playing } : null,
    { key: browseKey, panel: browse },
  )
  // Latest values for the observer, which outlives renders.
  const latest = useRef({ browse, onPlay })
  useEffect(() => {
    latest.current = { browse, onPlay }
  })

  // Watch the panel you are looking at for a player switching on.
  useEffect(() => {
    const frame = browseFrameRef.current
    if (!frame) return
    const check = () => {
      if (frame.querySelector('[data-playing="true"]')) latest.current.onPlay(latest.current.browse)
    }
    check()
    const observer = new MutationObserver(check)
    observer.observe(frame, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-playing'] })
    return () => observer.disconnect()
  }, [browseKey, browseFrameRef])

  const browseLabel = panelLabel(browse)
  return (
    <div className={styles.stack}>
      {frames.map((frame) => {
        const compact = frame.role === 'playing'
        return (
          <div
            key={frame.key}
            ref={compact ? nowFrameRef : browseFrameRef}
            className={compact ? styles.nowFrame : styles.browseFrame}
            data-role={frame.role}
          >
            {compact && (
              <div className={styles.nowBar} role="region" aria-label="Now playing">
                <p className={styles.nowLine}>
                  <span className={styles.nowEyebrow}>♪ Now playing</span>{' '}
                  <span className={styles.nowPlace}>{panelLabel(frame.panel)}</span>
                </p>
                <div className={styles.nowActions}>
                  <button type="button" className={styles.nowButton} onClick={() => onOpen(frame.panel)}>
                    Open
                  </button>
                  <button
                    type="button"
                    className={styles.nowButton}
                    onClick={onStop}
                    aria-label={`Stop playing ${panelLabel(frame.panel)}`}
                  >
                    ■ Stop
                  </button>
                </div>
                <p className={styles.lookingAt}>
                  {browseLabel
                    ? `You're looking at ${browseLabel}. ${panelLabel(frame.panel)} keeps playing until you press ▶ Play there.`
                    : `${panelLabel(frame.panel)} keeps playing while you explore. Press ▶ Play on another place to switch.`}
                </p>
              </div>
            )}
            <div className={compact ? styles.nowBody : styles.browseBody}>{renderPanel(frame.panel, frame.role)}</div>
          </div>
        )
      })}
    </div>
  )
}

/**
 * Phones: the playing panel sits below the globe, so the sticky year bar
 * carries a chip naming it — tap to scroll to the player.
 */
export function NowPlayingChip({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className={styles.chip} onClick={onClick}>
      <span aria-hidden="true">♪</span> Playing {label}
    </button>
  )
}
