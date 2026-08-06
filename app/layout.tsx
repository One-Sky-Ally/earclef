import { Fraunces, Inter } from 'next/font/google'
import Script from 'next/script'
import { ServiceProvider } from '@/components/listen/ServiceProvider'
import './globals.css'

const fraunces = Fraunces({
  variable: '--font-fraunces',
  subsets: ['latin'],
  style: ['normal', 'italic'],
  axes: ['opsz'],
})

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
})

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${fraunces.variable} ${inter.variable}`}>
      <body>
        <ServiceProvider>{children}</ServiceProvider>
        {/* Cloudflare Web Analytics — cookieless aggregate page stats,
            disclosed on /privacy. afterInteractive: never blocks
            rendering or hydration. */}
        <Script
          src="https://static.cloudflareinsights.com/beacon.min.js"
          strategy="afterInteractive"
          type="module"
          data-cf-beacon='{"token": "252a789071474223901c377b799eef9d"}'
        />
      </body>
    </html>
  )
}
