/**
 * Client-side palette sampling. Reads a handful of dominant colors from an
 * image (via canvas — the image itself is never reproduced in the page) and
 * nudges them into the site's dark-theatre range.
 */

interface Bucket {
  r: number
  g: number
  b: number
  count: number
}

function toHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  switch (max) {
    case rn:
      h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6
      break
    case gn:
      h = ((bn - rn) / d + 2) / 6
      break
    default:
      h = ((rn - gn) / d + 4) / 6
  }
  return [h, s, l]
}

export async function extractPalette(
  url: string,
  count = 4,
): Promise<string[] | null> {
  try {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.src = url
    await img.decode()

    const w = 48
    const h = 27
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(img, 0, 0, w, h)
    const data = ctx.getImageData(0, 0, w, h).data

    const buckets = new Map<number, Bucket>()
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5)
      const bucket = buckets.get(key)
      if (bucket) {
        bucket.r += r
        bucket.g += g
        bucket.b += b
        bucket.count++
      } else {
        buckets.set(key, { r, g, b, count: 1 })
      }
    }

    const ranked = [...buckets.values()]
      .map((b) => ({
        r: b.r / b.count,
        g: b.g / b.count,
        b: b.b / b.count,
        count: b.count,
      }))
      .sort((a, b) => b.count - a.count)

    // Pick top colors that are mutually distinct.
    const picked: { r: number; g: number; b: number }[] = []
    for (const candidate of ranked) {
      const distinct = picked.every(
        (p) =>
          Math.hypot(candidate.r - p.r, candidate.g - p.g, candidate.b - p.b) >
          56,
      )
      if (distinct) picked.push(candidate)
      if (picked.length === count) break
    }
    if (picked.length === 0) return null

    // Clamp into the site's dark-theatre range: saturated, mid-dark.
    return picked.map(({ r, g, b }) => {
      const [h, s, l] = toHsl(r, g, b)
      const cs = Math.max(s, 0.32)
      const cl = Math.min(Math.max(l, 0.3), 0.6)
      return `hsl(${Math.round(h * 360)} ${Math.round(cs * 100)}% ${Math.round(cl * 100)}%)`
    })
  } catch {
    return null
  }
}
