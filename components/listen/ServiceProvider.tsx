'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react'
import {
  isListenService,
  type ListenService,
} from '@/lib/listen/services'

const STORAGE_KEY = 'earclef_listen_service'

interface ServiceContextValue {
  service: ListenService
  setService: (service: ListenService) => void
}

const ServiceContext = createContext<ServiceContextValue>({
  service: 'youtube',
  setService: () => {},
})

/**
 * The fan's chosen listening service, site-wide. Renders with the
 * YouTube default, then upgrades after mount from localStorage and —
 * for signed-in fans — their fan record (which wins, so the preference
 * follows them across devices). Changing it writes both.
 */
export function ServiceProvider({ children }: { children: React.ReactNode }) {
  const [service, setServiceState] = useState<ListenService>('youtube')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const stored = localStorage.getItem(STORAGE_KEY)
      let next: ListenService | null = isListenService(stored) ? stored : null
      try {
        const res = await fetch('/api/fan')
        if (res.ok) {
          const body = (await res.json()) as {
            signedIn: boolean
            listenService?: string
          }
          if (body.signedIn && isListenService(body.listenService)) {
            next = body.listenService
          }
        }
      } catch {
        // localStorage (or the default) carries it.
      }
      if (!cancelled && next) setServiceState(next)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const setService = useCallback((choice: ListenService) => {
    setServiceState(choice)
    try {
      localStorage.setItem(STORAGE_KEY, choice)
    } catch {
      // Private-mode storage failures shouldn't break the choice.
    }
    // Best-effort persistence to the fan record; 401 just means signed out.
    fetch('/api/fan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ listenService: choice }),
    }).catch(() => {})
  }, [])

  return (
    <ServiceContext.Provider value={{ service, setService }}>
      {children}
    </ServiceContext.Provider>
  )
}

export function useListenService(): ServiceContextValue {
  return useContext(ServiceContext)
}
