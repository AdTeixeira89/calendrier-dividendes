import { onSnapshot } from 'firebase/firestore'
import { householdItemDoc } from '@/firebase/paths'
import type { BudgetSplitSettings } from '@/utils/budgetSplit'
import { upsertItem } from './repository'

interface Actor {
  uid: string
}

/** Répartition des revenus du foyer, dans `settings/budgetSplit` (aucun plan si absent). */
export function watchBudgetSplit(householdId: string, onChange: (settings: BudgetSplitSettings) => void, onError: (error: Error) => void): () => void {
  return onSnapshot(
    householdItemDoc(householdId, 'settings', 'budgetSplit'),
    (snap) => onChange({ plans: (snap.exists() ? (snap.data().plans as BudgetSplitSettings['plans'] | undefined) : undefined) ?? {} }),
    onError,
  )
}

export function saveBudgetSplit(householdId: string, settings: BudgetSplitSettings, actor: Actor): Promise<void> {
  return upsertItem(householdId, 'settings', 'budgetSplit', { plans: settings.plans }, actor)
}
