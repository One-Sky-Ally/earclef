import styles from './SectionHeader.module.css'

interface SectionHeaderProps {
  number: string
  title: string
  headingId: string
}

export function SectionHeader({ number, title, headingId }: SectionHeaderProps) {
  return (
    <div className={styles.header}>
      <span className={styles.number} aria-hidden="true">
        {number}
      </span>
      <h2 id={headingId} className={styles.title}>
        {title}
      </h2>
    </div>
  )
}
