/**
 * The Ear Clef mark — an original redraw, no third-party assets.
 * A yin-yang whose open half holds a treble clef and whose filled half
 * holds an ear; the full circle reads as a head in profile (nose and
 * lips on the left edge). Drawn entirely with currentColor so it works
 * at any size, in any single color, on any background.
 */
interface EarClefMarkProps {
  size?: number
  label?: string
}

/**
 * TEMPORARY: Stefano's original Canva-era mark, extracted to a transparent
 * PNG (public/images/earclef-mark.png), is displayed while he hand-draws
 * the final version. Flip this flag to false to return to the original
 * hand-drawn SVG below — nothing else needs to change.
 */
const USE_IMAGE_MARK = true

export function EarClefMark({ size = 32, label }: EarClefMarkProps) {
  const accessibility = label
    ? { role: 'img' as const, 'aria-label': label }
    : { 'aria-hidden': true as const }

  if (USE_IMAGE_MARK) {
    return (
      /* eslint-disable-next-line @next/next/no-img-element */
      <img
        src="/images/earclef-mark.png"
        width={size}
        height={size}
        style={{ maxWidth: 'none' }}
        alt={label ?? ''}
        {...accessibility}
      />
    )
  }

  return (
    <svg
      viewBox="0 0 108 100"
      width={size}
      height={Math.round(size * (100 / 108))}
      fill="none"
      {...accessibility}
    >
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M54 5 A22.5 22.5 0 0 1 54 50 A22.5 22.5 0 0 0 54 95 A45 45 0 0 0 54 5 Z
           M70 62 C77.2 62 81.8 67.2 81.2 74.2 C80.7 79.8 77 83.4 73.4 86.8 C70.8 89.3 66.2 89.6 64.2 87 C62.4 84.6 63.4 81.6 65.8 80 C68.4 78.3 70.6 77.2 71.1 74.2 C71.5 71.6 70 70 67.8 70 C65.6 70 64 71.4 63.6 73.6 C61.4 72.4 60.8 69.2 62 66.6 C63.4 63.6 66.4 62 70 62 Z
           M69.6 66 C73.4 65.8 76.4 68.7 76 72.4 C75.7 75.3 73.5 77.6 71.2 79.4 C70.4 76.9 72.1 74.9 71.8 72.6 C71.5 70.3 69.9 68.8 67.7 69.2 C68 67.6 68.6 66.2 69.6 66 Z"
      />
      <path
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M54 5
           A45 45 0 0 1 54 95
           A45 45 0 0 1 11.6 65
           C8 62.5 6.5 60.5 8.5 58.5
           C5.5 57.5 5.5 55.5 8 55
           C4.5 53.2 3 51 5 49.2
           C6.5 47.5 8.5 46 9.4 44
           A45 45 0 0 1 54 5"
      />
      <path
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M49.8 45.6
           C47 45.8 45.6 43.4 46.8 41.4
           C47.8 39.8 50.2 39.7 51.2 41.2
           C51.9 42.3 51.7 43.8 51.2 45
           L57 13
           C57.6 9.2 60.4 6.4 62.6 8.4
           C64.8 10.4 64 14.8 61.6 17.8
           C59 21 55.4 24.2 53 27.2
           C49 32 49.4 38.2 54.2 40.6
           C58.6 42.8 63.8 40.8 64.9 36.2
           C65.9 32 63.3 28.4 59.6 28.2
           C56.6 28 54.4 30.2 54.2 33"
      />
    </svg>
  )
}
