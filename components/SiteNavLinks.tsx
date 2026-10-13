'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Icon } from '@/components/ui/Icon'
import styles from './SiteNav.module.css'

const PAGES = [
  { href: '/', label: 'Explore' },
  { href: '/feed', label: 'Feed' },
  { href: '/artists', label: 'Artists' },
  { href: '/on-this-day', label: 'On this day' },
]

/** The Explore search input's id — the nav's search button focuses it. */
export const EXPLORE_SEARCH_ID = 'explore-search'

function activeFor(pathname: string): string | null {
  if (pathname === '/' || pathname.startsWith('/cultures')) return '/'
  if (pathname.startsWith('/feed')) return '/feed'
  if (pathname.startsWith('/artists') || pathname.startsWith('/a/')) {
    return '/artists'
  }
  if (pathname.startsWith('/on-this-day')) return '/on-this-day'
  if (pathname.startsWith('/me')) return '/me'
  return null
}

interface SiteNavLinksProps {
  /** Forced active entry — artist pages live at /<slug>, under Artists. */
  activeHref?: string
}

export function SiteNavLinks({ activeHref }: SiteNavLinksProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const active = activeHref ?? activeFor(pathname)

  // A route change closes the phone menu.
  const [menuPath, setMenuPath] = useState(pathname)
  if (menuPath !== pathname) {
    setMenuPath(pathname)
    setMenuOpen(false)
  }

  useEffect(() => {
    if (!menuOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false)
        menuButtonRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menuOpen])

  /** On Explore, jump straight into the search; elsewhere, go there. */
  function openSearch() {
    setMenuOpen(false)
    const input = document.getElementById(EXPLORE_SEARCH_ID)
    if (input instanceof HTMLInputElement) {
      input.scrollIntoView({ block: 'center', behavior: 'smooth' })
      input.focus({ preventScroll: true })
      return
    }
    router.push('/?focus=search')
  }

  const pageLinks = PAGES.map((page) => (
    <li key={page.href}>
      <Link
        className={styles.link}
        href={page.href}
        aria-current={active === page.href ? 'page' : undefined}
        onClick={() => setMenuOpen(false)}
      >
        {page.label}
      </Link>
    </li>
  ))

  return (
    <>
      <ul className={styles.links}>{pageLinks}</ul>
      <div className={styles.tools}>
        <button
          type="button"
          className={styles.iconButton}
          onClick={openSearch}
          aria-label="Search artists, cities or countries"
          title="Search"
        >
          <Icon name="search" size={20} />
        </button>
        <Link
          className={styles.tasteMap}
          href="/me"
          aria-current={active === '/me' ? 'page' : undefined}
        >
          <span className={styles.tasteMapIcon}>
            <Icon name="person" size={18} />
          </span>
          <span className={styles.tasteMapLabel}>My Taste Map</span>
        </Link>
        <button
          ref={menuButtonRef}
          type="button"
          className={`${styles.iconButton} ${styles.menuButton}`}
          onClick={() => setMenuOpen((open) => !open)}
          aria-expanded={menuOpen}
          aria-controls="site-menu"
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
        >
          <Icon name={menuOpen ? 'close' : 'menu'} size={22} />
        </button>
      </div>
      <div
        id="site-menu"
        className={styles.menu}
        hidden={!menuOpen}
      >
        <ul className={styles.menuLinks}>
          {pageLinks}
          <li>
            <Link
              className={styles.link}
              href="/me"
              aria-current={active === '/me' ? 'page' : undefined}
              onClick={() => setMenuOpen(false)}
            >
              My Taste Map
            </Link>
          </li>
        </ul>
      </div>
    </>
  )
}
