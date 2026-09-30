import { getDoc, onSnapshot, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore'
import { withDefaultSettings, type AlertSettings } from '@shared/alerts'
import { householdItemDoc } from '@/firebase/paths'

interface Actor {
  uid: string
}

/** Réglages partagés par le foyer, dans `settings/alerts` (valeurs par défaut si absent). */
export function watchAlertSettings(householdId: string, onChange: (settings: AlertSettings) => void, onError: (error: Error) => void): () => void {
  return onSnapshot(
    householdItemDoc(householdId, 'settings', 'alerts'),
    (snap) => onChange(withDefaultSettings(snap.exists() ? (snap.data() as Partial<AlertSettings>) : null)),
    onError,
  )
}

/**
 * Même schéma que les budgets : les règles interdisent de réécrire
 * `createdAt`/`createdBy`, on ne les envoie qu'à la création du document.
 */
export async function saveAlertSettings(householdId: string, settings: AlertSettings, actor: Actor): Promise<void> {
  const ref = householdItemDoc(householdId, 'settings', 'alerts')
  const snap = await getDoc(ref)
  if (!snap.exists()) {
    await setDoc(ref, {
      ...settings,
      householdId,
      createdBy: actor.uid,
      createdAt: serverTimestamp(),
      updatedBy: actor.uid,
      updatedAt: serverTimestamp(),
    })
    return
  }
  await updateDoc(ref, { ...settings, updatedBy: actor.uid, updatedAt: serverTimestamp() })
}
