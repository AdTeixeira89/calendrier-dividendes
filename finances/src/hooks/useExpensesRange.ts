import { watchExpensesRange } from '@/services/expenseService'
import { reportSyncError } from '@/services/repository'
import type { Expense } from '@/types'
import { budgetMonthTimestampRange } from '@/utils/budgetMonth'
import { monthTimestampRange, type MonthKey } from '@/utils/month'
import { useKeyedSnapshot } from './useKeyedSnapshot'

/**
 * Dépenses sur une plage de mois [from, to] (bornes incluses). `calendar` : mois civils (détection des
 * doublons d'un relevé importé) ; `budget` : mois budgétaires du 6 au 5 (export, comme le reste de l'app).
 */
export function useExpensesRange(householdId: string, from: MonthKey, to: MonthKey, mode: 'calendar' | 'budget' = 'calendar'): Expense[] | undefined {
  return useKeyedSnapshot<Expense[]>(`${householdId}:${from}:${to}:${mode}`, (onChange) => {
    const rangeOf = mode === 'budget' ? budgetMonthTimestampRange : monthTimestampRange
    const { start } = rangeOf(from)
    const { end } = rangeOf(to)
    return watchExpensesRange(householdId, start, end, onChange, (error) => {
      reportSyncError(error)
      onChange([])
    })
  })
}
