import { onSnapshot } from 'firebase/firestore'
import { householdItemDoc } from '@/firebase/paths'
import { upsertItem } from './repository'

/** Ce que l'accueil affiche : le commun du foyer, ou les finances personnelles du titulaire du compte. */
export type HomeView = 'common' | 'personal'

export interface HomePrefs {
  /** Dépenses : graphique et carte de l'accueil. */
  expenses: HomeView
  /** Épargne : carte de l'accueil. */
  savings: HomeView
}

export const DEFAULT_HOME_PREFS: HomePrefs = { expenses: 'common', savings: 'common' }

const docId = (uid: string) => `prefs-${uid}`

/**
 * Préférences d'affichage d'un titulaire de compte, mémorisées dans le foyer
 * (`settings/prefs-{uid}`) : elles le suivent d'un appareil à l'autre.
 */
export function watchHomePrefs(householdId: string, uid: string, onChange: (prefs: HomePrefs) => void, onError: (error: Error) => void): () => void {
  return onSnapshot(
    householdItemDoc(householdId, 'settings', docId(uid)),
    (snap) => {
      const data = snap.exists() ? (snap.data() as Partial<HomePrefs>) : {}
      onChange({
        expenses: data.expenses === 'personal' ? 'personal' : 'common',
        savings: data.savings === 'personal' ? 'personal' : 'common',
      })
    },
    onError,
  )
}

export function saveHomePref(householdId: string, uid: string, key: keyof HomePrefs, value: HomeView): Promise<void> {
  return upsertItem(householdId, 'settings', docId(uid), { [key]: value }, { uid }, { audit: false })
}
