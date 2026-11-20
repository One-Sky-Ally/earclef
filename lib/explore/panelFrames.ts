/**
 * Which panels the Explore page shows, and in what order, while music
 * plays (owner, Nov 19 2026: "keep exploring other places and years on
 * the globe without the player stopping … Browsing somewhere new shouldn't
 * replace what's playing until I choose to play the new place").
 *
 * Two panels at most:
 *   'playing' — the panel whose music is on. It stays MOUNTED, shrunk to
 *               its player, while you look elsewhere.
 *   'browse'  — the place, journey or artist you are looking at now.
 *   'both'    — you are looking at the place that is playing: one panel.
 *
 * The playing panel always comes FIRST. That is not taste: React keeps a
 * keyed panel mounted across renders, but if its DOM node ever moved, the
 * YouTube iframe inside it would reload and the music would stop. With
 * playing first, a new browse panel is only ever added AFTER it, and when
 * a browse panel starts playing, the old playing panel BEFORE it is
 * removed, so the playing node never moves.
 */

export type FrameRole = 'playing' | 'browse' | 'both'

export interface PanelRef<T> {
  key: string
  panel: T
}

export interface PanelFrame<T> {
  key: string
  role: FrameRole
  panel: T
}

export function panelFrames<T>(playing: PanelRef<T> | null, browse: PanelRef<T> | null): PanelFrame<T>[] {
  if (playing && browse && playing.key === browse.key) {
    return [{ key: browse.key, role: 'both', panel: browse.panel }]
  }
  return [
    ...(playing ? [{ key: playing.key, role: 'playing' as const, panel: playing.panel }] : []),
    ...(browse ? [{ key: browse.key, role: 'browse' as const, panel: browse.panel }] : []),
  ]
}
