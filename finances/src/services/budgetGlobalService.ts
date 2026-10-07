import { onSnapshot } from 'firebase/firestore'
import { householdItemDoc } from '@/firebase/paths'
import type { Cents } from '@/types'
import { upsertItem } from './repository'

interface Actor {
  uid: string
}

/** Budget global des dépenses communes inscrit par le foyer (`settings/budgetGlobal`), ou null s'il n'y en a pas. */
export function watchGlobalBudget(householdId: string, onChange: (totalCents: Cents | null) => void, onError: (error: Error) => void): () => void {
  return onSnapshot(
    householdItemDoc(householdId, 'settings', 'budgetGlobal'),
    (snap) => onChange(snap.exists() ? ((snap.data().totalCents as number | undefined) ?? null) : null),
    onError,
  )
}

/** Inscrit le budget global ; 0 ou null revient au total des sommes versées. */
export function saveGlobalBudget(householdId: string, totalCents: Cents | null, actor: Actor): Promise<void> {
  return upsertItem(householdId, 'settings', 'budgetGlobal', { totalCents: totalCents && totalCents > 0 ? totalCents : null }, actor)
}
