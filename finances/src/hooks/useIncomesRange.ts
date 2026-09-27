import { watchIncomesRange } from '@/services/incomeService'
import { reportSyncError } from '@/services/repository'
import type { Income } from '@/types'
import { monthTimestampRange, type MonthKey } from '@/utils/month'
import { useKeyedSnapshot } from './useKeyedSnapshot'

/** Revenus sur une plage de mois [from, to] (bornes incluses), ex. pour un export. */
export function useIncomesRange(householdId: string, from: MonthKey, to: MonthKey): Income[] | undefined {
  return useKeyedSnapshot<Income[]>(`${householdId}:${from}:${to}`, (onChange) => {
    const { start } = monthTimestampRange(from)
    const { end } = monthTimestampRange(to)
    return watchIncomesRange(householdId, start, end, onChange, (error) => {
      reportSyncError(error)
      onChange([])
    })
  })
}
