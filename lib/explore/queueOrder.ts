/**
 * Queue opening order: what a place plays FIRST.
 *
 * Children's and educational music stay in a place's queue but never
 * open it (owner ruling, Aug 2026). The rule is positional, and the
 * position that matters is what a visitor HEARS — roughly half a pool
 * resolves to no track at all, so counting artists would enforce
 * something other than the ruling.
 *
 * Pure so the rule is testable on its own: the queue engine around it
 * is a YouTube iframe, a worker pool and four abort paths, and the one
 * thing that must never quietly stop working is this.
 */

export interface DemotableTrack {
  /** In a genre family held out of the queue's opening run. */
  demoted?: boolean
}

export interface HoldState<T> {
  /** Tracks queued so far from outside the demoted families. */
  leadIn: number
  /** Demoted tracks waiting for the lead-in to fill. */
  held: T[]
}

export interface AppendPlan<T> extends HoldState<T> {
  /** Tracks to put in the queue now, in order. */
  commit: T[]
}

export const EMPTY_HOLD: HoldState<never> = { leadIn: 0, held: [] }

/**
 * Decide what enters the queue now and what waits.
 *
 * `defer` false means there is nothing else to lead with — the visitor
 * filtered the panel TO a demoted family, or the place has only that.
 * Both should just play; holding tracks back for a lead-in that can
 * never arrive would turn a demotion into a dead queue.
 */
export function planAppend<T extends DemotableTrack>(
  fresh: T[],
  state: HoldState<T>,
  defer: boolean,
  leadInTarget: number,
): AppendPlan<T> {
  if (!defer) {
    return {
      commit: [...state.held, ...fresh],
      leadIn: state.leadIn + fresh.length,
      held: [],
    }
  }
  const lead = fresh.filter((track) => !track.demoted)
  const held = [...state.held, ...fresh.filter((track) => track.demoted)]
  const leadIn = state.leadIn + lead.length
  // The lead-in is served: everything waiting comes in behind it.
  if (leadIn >= leadInTarget) return { commit: [...lead, ...held], leadIn, held: [] }
  return { commit: lead, leadIn, held }
}

/**
 * Everything still waiting, for the release valves: the pool ran dry,
 * or the first-track deadline passed with nothing else found. A queue
 * that ends in silence while holding playable tracks honours neither
 * half of "kids music stays, but not first".
 */
export function releasePlan<T extends DemotableTrack>(
  state: HoldState<T>,
): AppendPlan<T> {
  return { commit: state.held, leadIn: state.leadIn, held: [] }
}
