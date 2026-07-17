'use client'

import { useListenService } from '@/components/listen/ServiceProvider'
import {
  SERVICE_LABELS,
  SERVICE_ORDER,
  isListenService,
} from '@/lib/listen/services'
import styles from './ServicePicker.module.css'

/**
 * The small "Listen on" control. One choice, site-wide: every listen
 * link routes to this service (with honest fallbacks where an artist
 * isn't on it).
 */
export function ServicePicker() {
  const { service, setService } = useListenService()

  return (
    <label className={styles.picker}>
      <span className={styles.label}>Listen on</span>
      <select
        className={styles.select}
        value={service}
        onChange={(event) => {
          if (isListenService(event.target.value)) {
            setService(event.target.value)
          }
        }}
      >
        {SERVICE_ORDER.map((option) => (
          <option key={option} value={option}>
            {SERVICE_LABELS[option]}
          </option>
        ))}
      </select>
    </label>
  )
}
