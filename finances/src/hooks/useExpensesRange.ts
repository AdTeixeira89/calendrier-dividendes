import { watchExpensesRange } from '@/services/expenseService'
import { reportSyncError } from '@/services/repository'
import type { Expense } from '@/types'
import { monthTimestampRange, type MonthKey } from '@/utils/month'
import { useKeyedSnapshot } from './useKeyedSnapshot'

/** Dépenses sur une plage de mois [from, to] (bornes incluses), ex. pour un export. */
export function useExpensesRange(householdId: string, from: MonthKey, to: MonthKey): Expense[] | undefined {
  return useKeyedSnapshot<Expense[]>(`${householdId}:${from}:${to}`, (onChange) => {
    const { start } = monthTimestampRange(from)
    const { end } = monthTimestampRange(to)
    return watchExpensesRange(householdId, start, end, onChange, (error) => {
      reportSyncError(error)
      onChange([])
    })
  })
}
