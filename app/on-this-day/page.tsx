import type { Metadata } from 'next'
import { SiteNav } from '@/components/SiteNav'
import { OnThisDay } from '@/components/onthisday/OnThisDay'
import { parseMonthDay } from '@/lib/explore/onThisDay'
import { filtersFromParams } from '@/lib/explore/onThisDayFilters'

export const metadata: Metadata = {
  title: 'On this day — Ear Clef',
  description:
    'Music released on this day in past years, from every country with an exact release date. Pick any day — a birthday, an anniversary.',
}

/**
 * "On this day" (owner, Oct 10 2026). `?d=MM-DD` opens a chosen day;
 * without it the visitor's own today is read on their device. Sorting
 * and filters ride along too (?sort=newest&yr=d1960&loc=GB&g=jazz), so a
 * filtered day can be shared.
 */
export default async function OnThisDayPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const params = await searchParams
  const requested = params.d
  const initialDate = typeof requested === 'string' ? parseMonthDay(requested) : null
  const initialFilters = filtersFromParams((key) => {
    const value = params[key]
    return typeof value === 'string' ? value : null
  })
  return (
    <>
      <SiteNav showSections={false} />
      <main>
        <div className="container">
          <OnThisDay initialDate={initialDate} initialFilters={initialFilters} />
        </div>
      </main>
    </>
  )
}
