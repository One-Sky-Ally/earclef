import type { Metadata } from 'next'
import { SiteNav } from '@/components/SiteNav'
import { OnThisDay } from '@/components/onthisday/OnThisDay'
import { parseMonthDay } from '@/lib/explore/onThisDay'

export const metadata: Metadata = {
  title: 'On this day — Ear Clef',
  description:
    'Music released on this day in past years, from every country with an exact release date. Pick any day — a birthday, an anniversary.',
}

/**
 * "On this day" (owner, Oct 10 2026). `?d=MM-DD` opens a chosen day;
 * without it the visitor's own today is read on their device.
 */
export default async function OnThisDayPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const requested = (await searchParams).d
  const initialDate = typeof requested === 'string' ? parseMonthDay(requested) : null
  return (
    <>
      <SiteNav showSections={false} />
      <main>
        <div className="container">
          <OnThisDay initialDate={initialDate} />
        </div>
      </main>
    </>
  )
}
