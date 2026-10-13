import styles from './SectionHeader.module.css'

interface SectionHeaderProps {
  /** Kept for callers; the redesign shows no section numbers. */
  number?: string
  title: string
  headingId: string
  /** One plain line under the heading. */
  subtitle?: string
}

export function SectionHeader({ title, headingId, subtitle }: SectionHeaderProps) {
  return (
    <div className={styles.header}>
      <h2 id={headingId} className={styles.title}>
        {title}
      </h2>
      {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
    </div>
  )
}
