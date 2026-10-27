import { onSnapshot } from 'firebase/firestore'
import { householdItemDoc } from '@/firebase/paths'
import { rememberCategories, type CategoryRules } from '@/utils/categorize'
import { readBefore, upsertItem } from './repository'

interface Actor {
  uid: string
}

/** Catégories choisies lors des imports de relevé (`settings/categoryRules`), partagées par le foyer. */
export function watchCategoryRules(householdId: string, onChange: (rules: CategoryRules) => void, onError: (error: Error) => void): () => void {
  return onSnapshot(
    householdItemDoc(householdId, 'settings', 'categoryRules'),
    (snap) => onChange(snap.exists() ? ((snap.data().rules as CategoryRules | undefined) ?? {}) : {}),
    onError,
  )
}

/** Mémorise les catégories choisies pour que les prochains relevés les proposent d'office. */
export async function saveCategoryRules(householdId: string, rows: { label: string; categoryId: string | null }[], actor: Actor): Promise<number> {
  const learned = rows.filter((r) => r.categoryId)
  if (learned.length === 0) return 0
  const existing = ((await readBefore(householdItemDoc(householdId, 'settings', 'categoryRules')))?.rules as CategoryRules | undefined) ?? {}
  await upsertItem(householdId, 'settings', 'categoryRules', { rules: rememberCategories(learned, existing) }, actor, { audit: false })
  return learned.length
}
