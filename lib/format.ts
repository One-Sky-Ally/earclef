const SHOW_DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
})

export function formatShowDate(isoDate: string): string {
  return SHOW_DATE_FORMAT.format(new Date(`${isoDate}T00:00:00Z`))
}

export function byDateDescending<T extends { date: string }>(shows: T[]): T[] {
  return [...shows].sort((a, b) => b.date.localeCompare(a.date))
}

export function byDateAscending<T extends { date: string }>(shows: T[]): T[] {
  return [...shows].sort((a, b) => a.date.localeCompare(b.date))
}
