/**
 * WHICH verified upload a Discover card plays (owner rulings, Oct 11
 * 2026: "preferably an official music video"; "a trusted-uploader audio
 * track is OK when there's no official video").
 *
 * None of this is identity — identity is settled before these run (the
 * record-level Discogs bar in ./songIdentity, or the artist's own MB-
 * linked channel). These rank and prune: they pick WHICH video, never
 * WHO. All markers are read against the ANNOTATION only (the upload
 * title minus the artist prefix and the matched work title, see
 * ./contentGates annotationOf), so a song named "Official Video" or
 * "Live" is never misread.
 */
import { annotationOf } from './contentGates'
import { normalizeName } from './titleVariants'

export type UploadKind = 'official-video' | 'audio' | 'video'

/**
 * How channels label the OFFICIAL MUSIC VIDEO, across the site's
 * languages (measured Oct 11 2026 on 21 Discover picks + the Sep 28
 * "clip" finding). A bare "clip" is NOT here: as a ranking it would lift
 * fan clips over official audio, and only the paired forms are
 * unambiguous.
 */
export const OFFICIAL_VIDEO_MARKERS =
  /(?<![\p{L}\p{N}])(official (music |hd |4k )?video|official (video )?clip|music video|video oficial|videoclip oficial|video clip oficial|clip officiel|vid[eé]o officielle|official mv|m\/v|offizielles (musik)?video|video ufficiale|videoclipe oficial|official promo)(?![\p{L}\p{N}])/iu

/** Audio-only or lyric uploads: the record, without a film. */
export const AUDIO_MARKERS =
  /(?<![\p{L}\p{N}])(official audio|audio|lyric video|lyrics|visuali[sz]er|audio oficial|audio officiel|official stream)(?![\p{L}\p{N}])/iu

/**
 * A whole record is not a song. "Full Album" uploads pass the identity
 * bar (the record's title is on the record) and every content gate (it
 * IS music) — this is the one place the card's own meaning rules.
 */
export const WHOLE_RECORD_MARKERS =
  /(?<![\p{L}\p{N}])(full ?album|full ?ep|full ?lp|complete album|album completo|[áa]lbum completo|full set|full concert|full show|full live|full performance|full session|entire album|whole album|album stream|mixtape|discografia|discography)(?![\p{L}\p{N}])/iu

const TOPIC_CHANNEL = /\s-\s*topic$/i

export function uploadKindOf(
  uploadTitle: string,
  workTitle: string,
  artistName: string,
  uploader?: string,
): UploadKind {
  const annotation = annotationOf(uploadTitle, workTitle, artistName)
  if (OFFICIAL_VIDEO_MARKERS.test(annotation)) return 'official-video'
  if (AUDIO_MARKERS.test(annotation)) return 'audio'
  // A "- Topic" channel is YouTube's auto-generated audio of the record.
  if (uploader && TOPIC_CHANNEL.test(uploader)) return 'audio'
  return 'video'
}

export function isWholeRecordUpload(
  uploadTitle: string,
  workTitle: string,
  artistName: string,
): boolean {
  return WHOLE_RECORD_MARKERS.test(annotationOf(uploadTitle, workTitle, artistName))
}

/**
 * Organisation words that a channel name adds to or drops from the
 * entity it stands for: "DaptoneRecords" is Daptone Records, which is
 * "Daptone"; "MipsoVEVO" is Mipso's VEVO channel. Stripped
 * SYMMETRICALLY from both sides, and the remainder must be EQUAL —
 * this widens the alias set, never the comparison.
 */
const ORG_WORDS = /(records|recordings|recordingco|musik|music|label|official|vevo|tv|ltd|inc)+$/

function orgKeys(value: string): Set<string> {
  const full = normalizeName(value)
  if (!full) return new Set()
  const bare = full.replace(ORG_WORDS, '')
  return new Set(bare ? [full, bare] : [full])
}

/**
 * Uploaders whose non-official upload may still play: the artist
 * (their own, VEVO, "official" or Topic channel) or a label credited on
 * their Discogs records. Exact equality after the symmetric org-word
 * strip; an empty channel name trusts nothing.
 */
export function isTrustedUploader(
  channelTitle: string | undefined,
  aliases: ReadonlySet<string>,
  labels: readonly string[],
): boolean {
  if (!channelTitle) return false
  const topic = channelTitle.match(/^(.*?)\s-\s*topic$/i)
  if (topic) return aliases.has(normalizeName(topic[1]))
  const channel = orgKeys(channelTitle)
  for (const alias of aliases) {
    if (channel.has(alias)) return true
  }
  for (const label of labels) {
    for (const key of orgKeys(label)) {
      if (channel.has(key)) return true
    }
  }
  return false
}
