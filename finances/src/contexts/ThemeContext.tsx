import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

export type ThemePreference = 'dark' | 'light' | 'system'

export interface ThemeState {
  preference: ThemePreference
  resolved: 'dark' | 'light'
  setPreference: (preference: ThemePreference) => void
}

const STORAGE_KEY = 'foyer.theme'

export const ThemeContext = createContext<ThemeState | null>(null)

function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'dark' || stored === 'light' || stored === 'system') return stored
  } catch {
    // stockage indisponible (navigation privée) : thème par défaut
  }
  return 'dark'
}

const lightQuery = () => window.matchMedia('(prefers-color-scheme: light)')

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readPreference)
  const [systemLight, setSystemLight] = useState(() => lightQuery().matches)

  useEffect(() => {
    const query = lightQuery()
    const onChange = () => setSystemLight(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  const resolved = preference === 'system' ? (systemLight ? 'light' : 'dark') : preference

  useEffect(() => {
    document.documentElement.dataset.theme = resolved
    const meta = document.querySelector('meta[name="theme-color"]')
    meta?.setAttribute('content', resolved === 'dark' ? '#070a12' : '#f4f6fb')
  }, [resolved])

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // ignoré : la préférence restera valable pour la session
    }
  }, [])

  const value = useMemo(() => ({ preference, resolved, setPreference }), [preference, resolved, setPreference])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
