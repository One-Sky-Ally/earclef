import type { PlatformLink } from '@/lib/types'
import { platformLabel } from '@/lib/platforms'
import styles from './LinkPills.module.css'

interface LinkPillsProps {
  links: PlatformLink[]
  ariaLabel: string
}

export function LinkPills({ links, ariaLabel }: LinkPillsProps) {
  return (
    <ul className={styles.list} aria-label={ariaLabel}>
      {links.map((link) => (
        <li key={link.url}>
          <a
            className={styles.pill}
            href={link.url}
            target="_blank"
            rel="noreferrer"
          >
            {platformLabel(link.platform)}
          </a>
        </li>
      ))}
    </ul>
  )
}
