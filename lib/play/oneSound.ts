/**
 * One sound at a time, page-wide (owner, Nov 20 2026: "only one player
 * should ever sound at a time. Starting #1 hits, the main queue, Songs
 * about, or a journey should stop whatever else is playing, including
 * inside the same place").
 *
 * Every in-site player CLAIMS the sound when it starts sounding: its
 * own ▶, a next/previous, or YouTube's own play button on a paused
 * player. The player that held it is told to stop first. A player that
 * unmounts RELEASES it, so nothing tries to stop a player that is gone.
 *
 * Players are told apart by a symbol each, never by name: two queues
 * of the same place (the place's queue and its #1 hits) are different
 * players.
 */

export interface OneSound {
  /** This player starts sounding: whoever held the sound is stopped first. */
  claim: (id: symbol, stop: () => void) => void
  /** This player went away: it holds nothing any more. */
  release: (id: symbol) => void
  holds: (id: symbol) => boolean
}

export function createOneSound(): OneSound {
  let holder: { id: symbol; stop: () => void } | null = null
  return {
    claim(id, stop) {
      const previous = holder
      holder = { id, stop }
      if (!previous || previous.id === id) return
      try {
        previous.stop()
      } catch {
        // Its player went with its DOM: already silent.
      }
    },
    release(id) {
      if (holder?.id === id) holder = null
    },
    holds(id) {
      return holder?.id === id
    },
  }
}

/** The page's one sound: shared by every player module on the page. */
export const oneSound = createOneSound()
