/**
 * The YouTube IFrame Player API, loaded once per page and shared by
 * every in-site player (the place+era queue, the curated journey).
 * Playback always stays in the visible YouTube player, with YouTube's
 * own controls and branding.
 */

/** Minimal typing for the pieces of the IFrame API the site drives. */
export interface YtPlayer {
  loadVideoById: (videoId: string) => void
  playVideo?: () => void
  pauseVideo: () => void
  destroy: () => void
}

export interface YtNamespace {
  Player: new (
    element: HTMLElement,
    options: {
      videoId: string
      /** Embed origin — always NO_COOKIE_HOST (see below). */
      host?: string
      playerVars: Record<string, number>
      events: {
        onReady: (event: { target: { playVideo: () => void } }) => void
        onStateChange: (event: { data: number }) => void
        /** 2/5/100/101/150 — malformed id, or gone/unembeddable. */
        onError: (event: { data: number }) => void
      }
    },
  ) => YtPlayer
  PlayerState: { ENDED: number; PLAYING: number; PAUSED: number }
}

declare global {
  interface Window {
    YT?: YtNamespace
    onYouTubeIframeAPIReady?: () => void
  }
}

/**
 * Every IFrame-API player embeds from YouTube's privacy-enhanced domain
 * (owner go, Nov 19 2026), like the site's plain embeds: YouTube sets no
 * cookies until the visitor plays a video. Needed for the Developer
 * Policies (III.A.2) and the privacy page's cookie promise.
 */
export const NO_COOKIE_HOST = 'https://www.youtube-nocookie.com'

let ytApiPromise: Promise<YtNamespace> | null = null

export function loadYouTubeApi(): Promise<YtNamespace> {
  if (typeof window !== 'undefined' && window.YT?.Player) {
    return Promise.resolve(window.YT)
  }
  if (ytApiPromise) return ytApiPromise
  ytApiPromise = new Promise((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      previous?.()
      if (window.YT) resolve(window.YT)
    }
    const script = document.createElement('script')
    script.src = 'https://www.youtube.com/iframe_api'
    script.onerror = () => {
      ytApiPromise = null
      reject(new Error('YouTube player failed to load'))
    }
    document.head.appendChild(script)
  })
  return ytApiPromise
}

/** A video's still, for a facade before the player loads. */
export function youtubeThumb(videoId: string, size: 'hq' | 'mq' = 'hq'): string {
  return `https://i.ytimg.com/vi/${videoId}/${size}default.jpg`
}
