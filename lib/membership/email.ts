/**
 * Transactional email via the Resend HTTP API — plain fetch, no SDK.
 * Three sends exist, total: the magic link, the ~2-weeks-out expiry
 * reminder, and one gentle post-expiry note. That is the whole email
 * surface of the No-Inertia model; nothing here is a campaign.
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails'

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY)
}

function sender(): string {
  return process.env.EMAIL_FROM ?? 'Ear Clef <onboarding@resend.dev>'
}

async function sendEmail(args: {
  to: string
  subject: string
  text: string
}): Promise<boolean> {
  const key = process.env.RESEND_API_KEY
  if (!key) return false
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: sender(),
        to: [args.to],
        subject: args.subject,
        text: args.text,
      }),
    })
    if (!res.ok) {
      console.error('Resend send failed:', res.status, await res.text())
      return false
    }
    return true
  } catch (error) {
    console.error('Resend send failed:', error)
    return false
  }
}

export function sendMagicLink(args: {
  to: string
  artistName: string
  link: string
}): Promise<boolean> {
  return sendEmail({
    to: args.to,
    subject: `Your sign-in link for ${args.artistName} on Ear Clef`,
    text: [
      `Here's your sign-in link for ${args.artistName}'s Universe:`,
      '',
      args.link,
      '',
      'It works once and expires in 15 minutes.',
      "If you didn't request this, you can ignore it — nothing happens without the link.",
    ].join('\n'),
  })
}

export function sendExpiryReminder(args: {
  to: string
  artistName: string
  expiresOn: string
  renewLink: string
}): Promise<boolean> {
  return sendEmail({
    to: args.to,
    subject: `Your year with ${args.artistName} ends ${args.expiresOn}`,
    text: [
      `Your year inside ${args.artistName}'s Universe ends on ${args.expiresOn}.`,
      '',
      'Nothing renews on its own — no card is stored, and this is the only reminder.',
      'If you want another year, it takes one click:',
      '',
      args.renewLink,
      '',
      'And if not: thank you for this one.',
    ].join('\n'),
  })
}

export function sendExpiryFollowup(args: {
  to: string
  artistName: string
  renewLink: string
}): Promise<boolean> {
  return sendEmail({
    to: args.to,
    subject: `Your year with ${args.artistName} has ended`,
    text: [
      `Your year inside ${args.artistName}'s Universe has ended — as promised, nothing renewed by itself.`,
      '',
      'The door stays open. If you want back in, it takes one click:',
      '',
      args.renewLink,
      '',
      "Either way, this is the last note we'll send about it.",
    ].join('\n'),
  })
}
