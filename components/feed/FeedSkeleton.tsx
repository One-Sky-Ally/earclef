import styles from './FeedSkeleton.module.css'

/**
 * Placeholder post cards while the feed gathers itself: a slowly
 * spinning vinyl-ring motif where the art will land, shimmer bars where
 * the words will. Pure CSS — reduced-motion users get a static version
 * via the global animation kill-switch.
 */
export function FeedSkeleton({ count }: { count: number }) {
  return (
    <div className={styles.stack} aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className={styles.card}>
          <div className={styles.media}>
            <svg
              className={styles.vinyl}
              viewBox="0 0 100 100"
              xmlns="http://www.w3.org/2000/svg"
            >
              <circle cx="50" cy="50" r="44" fill="none" strokeWidth="1" />
              <circle cx="50" cy="50" r="34" fill="none" strokeWidth="0.8" />
              <circle cx="50" cy="50" r="24" fill="none" strokeWidth="0.6" />
              <circle cx="50" cy="50" r="5" className={styles.vinylDot} />
              <circle
                cx="50"
                cy="6"
                r="2"
                className={styles.vinylMarker}
              />
            </svg>
          </div>
          <div className={styles.body}>
            <div className={`${styles.bar} ${styles.barShort}`} />
            <div className={`${styles.bar} ${styles.barTitle}`} />
            <div className={styles.bar} />
            <div className={`${styles.bar} ${styles.barTrail}`} />
          </div>
        </div>
      ))}
    </div>
  )
}
