import { watchMonthlyIncomes } from '@/services/incomeService'
import { reportSyncError } from '@/services/repository'
import type { Income } from '@/types'
import type { MonthKey } from '@/utils/month'
import { useKeyedSnapshot } from './useKeyedSnapshot'

export function useMonthlyIncomes(householdId: string, month: MonthKey): Income[] | undefined {
  return useKeyedSnapshot<Income[]>(`${householdId}:${month}`, (onChange) =>
    watchMonthlyIncomes(householdId, month, onChange, (error) => {
      reportSyncError(error)
      onChange([])
    }),
  )
}
