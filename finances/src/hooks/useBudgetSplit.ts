import { watchBudgetSplit } from '@/services/budgetSplitService'
import { reportSyncError } from '@/services/repository'
import type { BudgetSplitSettings } from '@/utils/budgetSplit'
import { useKeyedSnapshot } from './useKeyedSnapshot'

export function useBudgetSplit(householdId: string): BudgetSplitSettings | undefined {
  return useKeyedSnapshot<BudgetSplitSettings>(householdId, (onChange) =>
    watchBudgetSplit(householdId, onChange, (error) => {
      reportSyncError(error)
      onChange({ plans: {} })
    }),
  )
}
