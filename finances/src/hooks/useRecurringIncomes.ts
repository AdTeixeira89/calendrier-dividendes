import { reportSyncError } from '@/services/repository'
import { watchRecurringIncomes } from '@/services/recurringIncomeService'
import type { RecurringIncome } from '@/types'
import { useKeyedSnapshot } from './useKeyedSnapshot'

/** Revenus fixes du foyer (arrêtés compris). */
export function useRecurringIncomes(householdId: string): RecurringIncome[] | undefined {
  return useKeyedSnapshot<RecurringIncome[]>(householdId, (onChange) =>
    watchRecurringIncomes(householdId, onChange, (error) => {
      reportSyncError(error)
      onChange([])
    }),
  )
}
