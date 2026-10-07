import { watchGlobalBudget } from '@/services/budgetGlobalService'
import { reportSyncError } from '@/services/repository'
import type { Cents } from '@/types'
import { useKeyedSnapshot } from './useKeyedSnapshot'

/** Budget global inscrit : un montant, null si aucun, undefined pendant le chargement. */
export function useGlobalBudget(householdId: string): Cents | null | undefined {
  return useKeyedSnapshot<Cents | null>(householdId, (onChange) =>
    watchGlobalBudget(householdId, onChange, (error) => {
      reportSyncError(error)
      onChange(null)
    }),
  )
}
