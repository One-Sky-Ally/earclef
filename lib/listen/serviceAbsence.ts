import verdicts from './service-absence.json'
import type { ServiceAbsence } from './services'

/**
 * Confirmed absences from streaming services, written ONLY by
 * scripts/verify-service-absence.mjs (run on the owner's Mac — the
 * services are unreachable from the cloud container). The owner's rule
 * (Oct 13 2026): a note like "Not on Spotify" shows only when the
 * absence is CONFIRMED; a missing link in our data is not proof.
 *
 * A verdict is `absent` only when every leg the verifier could run
 * agreed: no link to the service on the artist's MusicBrainz record,
 * no platform link or id for it in the content file, and the service's
 * own artist search returned no artist of that name. Anything the
 * verifier could not check is `unknown`, and unknown never shows a
 * note. The verdict carries its evidence and the day it was checked.
 */

export type AbsenceStatus = 'absent' | 'present' | 'unknown'

export interface AbsenceVerdict {
  status: AbsenceStatus
  checkedAt: string
  evidence: string
}

export interface ServiceAbsenceFile {
  generatedAt: string | null
  /** slug → service → verdict */
  artists: Record<string, Record<string, AbsenceVerdict>>
}

const FILE = verdicts as ServiceAbsenceFile

const SERVICES = new Set(['spotify', 'appleMusic', 'amazonMusic', 'deezer', 'tidal'])

/** Verified absences for one roster artist — only `absent` verdicts. */
export function confirmedAbsences(slug: string): ServiceAbsence[] {
  const byService = FILE.artists?.[slug]
  if (!byService) return []
  return Object.entries(byService)
    .filter(
      ([service, verdict]) =>
        SERVICES.has(service) &&
        verdict?.status === 'absent' &&
        typeof verdict.checkedAt === 'string' &&
        typeof verdict.evidence === 'string' &&
        verdict.evidence.length > 0,
    )
    .map(([service]) => ({
      platform: service as ServiceAbsence['platform'],
      source: 'verified' as const,
    }))
}
