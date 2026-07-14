'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import type { MembershipContent } from '@/lib/types'
import type { UniverseResponse } from '@/lib/membership/types'
import { SectionHeader } from '@/components/SectionHeader'
import { UniverseFeed } from '@/components/universe/UniverseFeed'
import { UniverseLocked } from '@/components/universe/UniverseLocked'
import styles from './Universe.module.css'

interface UniverseSectionProps {
  slug: string
  artistName: string
  membership: MembershipContent
}

type Banner = { tone: 'good' | 'bad'; text: string } | null

/** One-shot flags the auth/claim redirects leave in the query string. */
function readBanner(params: URLSearchParams): Banner {
  if (params.get('joined') === '1') {
    return { tone: 'good', text: "You're in — welcome to the inner circle." }
  }
  if (params.get('joined') === 'failed') {
    return {
      tone: 'bad',
      text: 'That payment could not be confirmed. Nothing was recorded — try again or reach out.',
    }
  }
  if (params.get('signin') === 'ok') {
    return { tone: 'good', text: 'Signed in.' }
  }
  if (params.get('renew') === 'unavailable' || params.get('renew') === 'failed') {
    return {
      tone: 'bad',
      text: 'Renewal is not available right now — nothing was charged.',
    }
  }
  return null
}

export function UniverseSection(props: UniverseSectionProps) {
  return (
    <section
      id="universe"
      className="section"
      aria-labelledby="universe-heading"
    >
      <div className="container">
        <SectionHeader
          number="∞"
          title={props.membership.perkTitle}
          headingId="universe-heading"
        />
        {/* useSearchParams below requires a Suspense boundary during SSG. */}
        <Suspense fallback={<p className={styles.quiet}>Opening…</p>}>
          <UniverseBody {...props} />
        </Suspense>
      </div>
    </section>
  )
}

function UniverseBody({ slug, artistName, membership }: UniverseSectionProps) {
  const searchParams = useSearchParams()
  const banner = readBanner(searchParams)
  const [data, setData] = useState<UniverseResponse | null>(null)
  const [failed, setFailed] = useState(false)
  const [fetchCount, setFetchCount] = useState(0)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/universe/${slug}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const body = (await res.json()) as UniverseResponse
        if (!cancelled) {
          setData(body)
          setFailed(false)
        }
      } catch (error) {
        console.error('Universe fetch failed:', error)
        if (!cancelled) setFailed(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [slug, fetchCount])

  return (
    <>
      {banner && (
        <p
          className={
            banner.tone === 'good' ? styles.bannerGood : styles.bannerBad
          }
        >
          {banner.text}
        </p>
      )}
      {failed && (
        <p className={styles.quiet}>
          The Universe could not load — please try again shortly.
        </p>
      )}
      {!failed && !data && <p className={styles.quiet}>Opening…</p>}
      {data?.locked === false && (
        <UniverseFeed
          slug={slug}
          artistName={artistName}
          data={data}
          onSignedOut={() => setFetchCount((count) => count + 1)}
        />
      )}
      {data?.locked === true && (
        <UniverseLocked slug={slug} membership={membership} data={data} />
      )}
    </>
  )
}
