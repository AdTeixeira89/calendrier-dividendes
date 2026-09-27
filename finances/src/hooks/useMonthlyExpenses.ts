import { watchMonthlyExpenses } from '@/services/expenseService'
import { reportSyncError } from '@/services/repository'
import type { Expense } from '@/types'
import type { MonthKey } from '@/utils/month'
import { useKeyedSnapshot } from './useKeyedSnapshot'

export function useMonthlyExpenses(householdId: string, month: MonthKey): Expense[] | undefined {
  return useKeyedSnapshot<Expense[]>(`${householdId}:${month}`, (onChange) =>
    watchMonthlyExpenses(householdId, month, onChange, (error) => {
      reportSyncError(error)
      onChange([])
    }),
  )
}
