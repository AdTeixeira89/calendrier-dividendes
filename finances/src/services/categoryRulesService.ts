import { onSnapshot } from 'firebase/firestore'
import { householdItemDoc } from '@/firebase/paths'
import type { BusinessKind } from '@/types'
import { rememberBusiness, rememberCategories, type BusinessRules, type CategoryRules } from '@/utils/categorize'
import { readBefore, upsertItem } from './repository'

interface Actor {
  uid: string
}

export interface StatementMemory {
  rules: CategoryRules
  business: BusinessRules
}

/** Ce que le foyer a retenu des imports de relevé (`settings/categoryRules`) : catégories par commerçant et frais d'entreprise. */
export function watchCategoryRules(householdId: string, onChange: (memory: StatementMemory) => void, onError: (error: Error) => void): () => void {
  return onSnapshot(
    householdItemDoc(householdId, 'settings', 'categoryRules'),
    (snap) => {
      const data = snap.exists() ? snap.data() : {}
      onChange({ rules: (data.rules as CategoryRules | undefined) ?? {}, business: (data.business as BusinessRules | undefined) ?? {} })
    },
    onError,
  )
}

/**
 * Mémorise les catégories choisies (et, pour un import dans un espace personnel, les frais d'entreprise
 * cochés ou décochés) pour que les prochains relevés les proposent d'office.
 */
export async function saveCategoryRules(
  householdId: string,
  rows: { label: string; categoryId: string | null; business?: BusinessKind | null }[],
  actor: Actor,
  options: { business?: boolean } = {},
): Promise<number> {
  const learned = rows.filter((r) => r.categoryId)
  if (learned.length === 0 && !options.business) return 0
  const existing = await readBefore(householdItemDoc(householdId, 'settings', 'categoryRules'))
  const data: Record<string, unknown> = { rules: rememberCategories(learned, (existing?.rules as CategoryRules | undefined) ?? {}) }
  if (options.business) data.business = rememberBusiness(rows.map((r) => ({ label: r.label, business: r.business ?? null })), (existing?.business as BusinessRules | undefined) ?? {})
  await upsertItem(householdId, 'settings', 'categoryRules', data, actor, { audit: false })
  return learned.length
}
