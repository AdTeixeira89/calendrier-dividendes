import { useCallback } from 'react'
import { useCurrentUser } from '@/hooks/useAuth'
import { DEFAULT_HOME_PREFS, saveHomePref, watchHomePrefs, type HomePrefs, type HomeView } from '@/services/homePrefsService'
import { reportSyncError } from '@/services/repository'
import { useKeyedSnapshot } from './useKeyedSnapshot'

/** Préférences d'affichage de l'accueil du titulaire du compte (commun par défaut), et leur modification. */
export function useHomePrefs(householdId: string): { prefs: HomePrefs; setPref: (key: keyof HomePrefs, value: HomeView) => void } {
  const user = useCurrentUser()
  const prefs = useKeyedSnapshot<HomePrefs>(`${householdId}:${user.uid}`, (onChange) =>
    watchHomePrefs(householdId, user.uid, onChange, (error) => {
      reportSyncError(error)
      onChange(DEFAULT_HOME_PREFS)
    }),
  )
  const setPref = useCallback((key: keyof HomePrefs, value: HomeView) => void saveHomePref(householdId, user.uid, key, value).catch(reportSyncError), [householdId, user.uid])
  return { prefs: prefs ?? DEFAULT_HOME_PREFS, setPref }
}
