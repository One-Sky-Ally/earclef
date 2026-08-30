import { ImageResponse } from 'next/og'
import { getAllArtists, getArtistBySlug } from '@/lib/content'

/**
 * The artist share card, generated per slug at build time.
 *
 * WHY GENERATED. Every one of the 131 artists pointed `meta.ogImage`
 * at `/images/og-<slug>.jpg` and not one of those files has ever
 * existed, so every shared link previewed as a broken image. The
 * obvious repair — fall back to the hero image — does not work here:
 * 130 of 131 heroes are `/images/hero-placeholder.svg`, and SVG is not
 * a format Facebook, Slack, X or iMessage will render as a preview.
 * The artwork a visitor actually sees is built CLIENT-side by HeroArt
 * from a YouTube thumbnail palette, and no crawler runs it.
 *
 * So the card is drawn here from what the record genuinely holds:
 * name, place, and the one-line identity every artist has.
 *
 * Satori (what ImageResponse renders with) supports flexbox and a
 * subset of CSS — no grid — and every container needs an explicit
 * display. Type is the bundled default face rather than the site's
 * Fraunces: next/font/google gives no binary to hand Satori, and
 * fetching one at build time would put the build on the network.
 * The brand carries on palette, layout and the wordmark instead.
 */

const SIZE = { width: 1200, height: 630 }

/** Match the page route: one card per artist, all at build time. */
export function generateStaticParams() {
  return getAllArtists().map((artist) => ({ slug: artist.slug }))
}

/**
 * One card per artist, named. A module-level `alt` export would read
 * "Ear Clef artist card" on all 131 — this is the text a screen reader
 * announces when someone shares the link, so it says whose card it is.
 */
export function generateImageMetadata({ params }: { params: { slug: string } }) {
  const name = getArtistBySlug(params.slug)?.hero.name
  return [
    {
      id: 'card',
      alt: name ? `${name} on Ear Clef` : 'Ear Clef',
      size: SIZE,
      contentType: 'image/png',
    },
  ]
}

const BG = '#161210'
const TEXT = '#f2ede4'
const SOFT = '#cfc7ba'
const MUTED = '#a89f92'
const ACCENT = '#f2a93b'

/** Long names have to shrink or they run off the card. */
function nameSize(name: string): number {
  if (name.length > 28) return 62
  if (name.length > 20) return 76
  return 92
}

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const content = getArtistBySlug(slug)
  // A missing slug still has to produce an image: the route is
  // statically generated, and throwing here would fail the build over
  // a preview card.
  const name = content?.hero.name ?? 'Ear Clef'
  const location = content?.hero.location ?? ''
  const identity = content?.hero.identity ?? 'Music in balance'

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          backgroundColor: BG,
          backgroundImage: `radial-gradient(900px 500px at 78% 12%, rgba(242,169,59,0.16), rgba(22,18,16,0) 70%)`,
          padding: '64px 72px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div
            style={{
              width: 18,
              height: 18,
              borderRadius: 9,
              backgroundColor: ACCENT,
              display: 'flex',
            }}
          />
          <div
            style={{
              display: 'flex',
              fontSize: 24,
              letterSpacing: 6,
              color: ACCENT,
              fontWeight: 600,
            }}
          >
            EAR CLEF
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {location && (
            <div
              style={{
                display: 'flex',
                fontSize: 24,
                letterSpacing: 4,
                color: MUTED,
                textTransform: 'uppercase',
                marginBottom: 18,
              }}
            >
              {location}
            </div>
          )}
          <div
            style={{
              display: 'flex',
              fontSize: nameSize(name),
              lineHeight: 1.05,
              color: TEXT,
              fontWeight: 700,
              marginBottom: 26,
            }}
          >
            {name}
          </div>
          <div
            style={{
              display: 'flex',
              fontSize: 28,
              lineHeight: 1.45,
              color: SOFT,
              maxWidth: 900,
            }}
          >
            {identity}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div
            style={{ display: 'flex', width: 72, height: 3, backgroundColor: ACCENT }}
          />
          <div style={{ display: 'flex', fontSize: 22, color: MUTED }}>
            Music in balance
          </div>
        </div>
      </div>
    ),
    SIZE,
  )
}
