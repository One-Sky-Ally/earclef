/**
 * The names the globe pins over places (owner, Nov 20 2026: "mark the
 * place that's currently playing on the globe itself, so I can see
 * where the music is coming from while I browse elsewhere").
 *
 *   'selected' — the place being looked at (the coral pill).
 *   'featured' — the curated journey on show, when nothing is selected.
 *   'playing'  — where the music comes from, while you look elsewhere.
 *
 * One place never wears two pins: when the playing place IS the one
 * pinned already, that pin takes the ♪ and the playing label instead
 * ("♪ Egypt 1966" while looking at Egypt 1980). Claimed places carry
 * their own permanent marker, so they never get a pin; the globe lights
 * that marker for both selection and playing.
 */

export interface PinPlace {
  code: string
  name: string
}

export interface PlayingPlace {
  code: string
  /** What plays, as the Now playing bar names it: "Egypt 1966". */
  label: string
}

export type PinRole = 'selected' | 'featured' | 'playing'

export interface PinPlan {
  code: string
  text: string
  role: PinRole
  playing: boolean
}

interface PinInputs {
  selected: PinPlace | null
  featured: PinPlace | null
  playing: PlayingPlace | null
  claimed: (code: string) => boolean
}

export function playingText(playing: PlayingPlace): string {
  return `♪ ${playing.label}`
}

export function planPins({ selected, featured, playing, claimed }: PinInputs): PinPlan[] {
  // The featured journey is named only while nothing is selected.
  const shown = selected ?? featured
  const role: PinRole = selected ? 'selected' : 'featured'
  const isPlaying = shown !== null && playing !== null && playing.code === shown.code
  const shownPin: PinPlan[] =
    shown && !claimed(shown.code)
      ? [
          {
            code: shown.code,
            text: isPlaying && playing ? playingText(playing) : shown.name,
            role,
            playing: isPlaying,
          },
        ]
      : []
  const playingPin: PinPlan[] =
    playing && !isPlaying && !claimed(playing.code)
      ? [{ code: playing.code, text: playingText(playing), role: 'playing', playing: true }]
      : []
  return [...shownPin, ...playingPin]
}
