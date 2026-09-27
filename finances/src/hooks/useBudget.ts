import { watchBudget } from '@/services/budgetService'
import { reportSyncError } from '@/services/repository'
import type { Budget } from '@/types'
import type { MonthKey } from '@/utils/month'
import { useKeyedSnapshot } from './useKeyedSnapshot'

export function useBudget(householdId: string, month: MonthKey): Budget | null | undefined {
  return useKeyedSnapshot<Budget | null>(`${householdId}:${month}`, (onChange) =>
    watchBudget(householdId, month, onChange, (error) => {
      reportSyncError(error)
      onChange(null)
    }),
  )
}
