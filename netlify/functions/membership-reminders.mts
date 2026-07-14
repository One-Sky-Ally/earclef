import { listAllMembers, putMember } from '../../lib/membership/store'
import {
  sendExpiryFollowup,
  sendExpiryReminder,
} from '../../lib/membership/email'
import {
  RENEW_LINK_TTL_MS,
  signToken,
} from '../../lib/membership/tokens'
import roster from '../../lib/discover/roster.json'

/**
 * The No-Inertia mail run, once a day: ONE reminder ~2 weeks before a
 * membership ends (with a one-click renew link), and ONE gentle note
 * shortly after it ends. Both are marked on the record so they can never
 * repeat, and the post-expiry window is capped so a paused function
 * never emails about long-dead memberships when it wakes up.
 */

const DAY_MS = 24 * 60 * 60 * 1000
const REMINDER_WINDOW_MS = 14 * DAY_MS
const FOLLOWUP_AFTER_MS = 3 * DAY_MS
const FOLLOWUP_CUTOFF_MS = 17 * DAY_MS

function artistName(slug: string): string {
  return roster.find((artist) => artist.slug === slug)?.name ?? slug
}

function renewLink(base: string, email: string, slug: string): string {
  const token = signToken({
    t: 'renew',
    email,
    slug,
    exp: Date.now() + RENEW_LINK_TTL_MS,
  })
  return `${base}/api/membership/renew?token=${encodeURIComponent(token)}`
}

export default async function handler(): Promise<Response> {
  const base = process.env.URL
  if (!base || !process.env.AUTH_SECRET || !process.env.RESEND_API_KEY) {
    console.log('membership-reminders: not configured, skipping run')
    return new Response('not configured', { status: 200 })
  }

  const now = Date.now()
  const members = await listAllMembers()
  let reminded = 0
  let followedUp = 0

  for (const member of members) {
    const expires = new Date(member.expiresAt).getTime()
    const name = artistName(member.artistSlug)

    const needsReminder =
      !member.remindedAt && expires > now && expires - now <= REMINDER_WINDOW_MS
    if (needsReminder) {
      const sent = await sendExpiryReminder({
        to: member.email,
        artistName: name,
        expiresOn: member.expiresAt.slice(0, 10),
        renewLink: renewLink(base, member.email, member.artistSlug),
      })
      if (sent) {
        await putMember({ ...member, remindedAt: new Date(now).toISOString() })
        reminded++
      }
      continue
    }

    const sinceExpiry = now - expires
    const needsFollowup =
      !member.followupAt &&
      sinceExpiry >= FOLLOWUP_AFTER_MS &&
      sinceExpiry <= FOLLOWUP_CUTOFF_MS
    if (needsFollowup) {
      const sent = await sendExpiryFollowup({
        to: member.email,
        artistName: name,
        renewLink: renewLink(base, member.email, member.artistSlug),
      })
      if (sent) {
        await putMember({ ...member, followupAt: new Date(now).toISOString() })
        followedUp++
      }
    }
  }

  const summary = `membership-reminders: ${members.length} records, ${reminded} reminded, ${followedUp} followed up`
  console.log(summary)
  return new Response(summary)
}

export const config = {
  schedule: '0 14 * * *',
}
