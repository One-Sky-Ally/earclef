import { NextResponse } from 'next/server'

/**
 * Client error beacon: writes structured client-side failures into the
 * function logs (Netlify → Logs → Functions) so field failures carry a
 * reason. No storage, no auth — payloads are size-capped and logged
 * only; abuse is bounded to noisy logs.
 */

const MAX_BODY = 2048

export async function POST(request: Request) {
  try {
    const raw = await request.text()
    if (raw.length > MAX_BODY) {
      return new NextResponse(null, { status: 413 })
    }
    const body = JSON.parse(raw) as {
      context?: string
      reason?: string
      detail?: string
      ua?: string
    }
    console.error(
      '[client-error]',
      String(body.context ?? '').slice(0, 60),
      '|',
      String(body.reason ?? '').slice(0, 200),
      '|',
      String(body.detail ?? '').slice(0, 500),
      '|',
      String(body.ua ?? '').slice(0, 200),
    )
  } catch {
    // Malformed beacons are dropped silently.
  }
  const response = new NextResponse(null, { status: 204 })
  response.headers.set('Cache-Control', 'no-store')
  return response
}
