import { watchExpensesRange } from '@/services/expenseService'
import { reportSyncError } from '@/services/repository'
import type { Expense } from '@/types'
import { expenseBudgetMonth, expenseFetchTimestampRange } from '@/utils/budgetMonth'
import { monthTimestampRange, type MonthKey } from '@/utils/month'
import { useKeyedSnapshot } from './useKeyedSnapshot'

/**
 * Dépenses sur une plage de mois [from, to] (bornes incluses). `calendar` : mois civils (détection des
 * doublons d'un relevé importé) ; `budget` : mois budgétaires du 6 au 5 (export, comme le reste de l'app).
 */
export function useExpensesRange(householdId: string, from: MonthKey, to: MonthKey, mode: 'calendar' | 'budget' = 'calendar'): Expense[] | undefined {
  return useKeyedSnapshot<Expense[]>(`${householdId}:${from}:${to}:${mode}`, (onChange) => {
    if (mode === 'budget') {
      const { start, end } = expenseFetchTimestampRange(from, to)
      return watchExpensesRange(householdId, start, end, (list) => onChange(list.filter((e) => { const m = expenseBudgetMonth(e); return m >= from && m <= to })), (error) => {
        reportSyncError(error)
        onChange([])
      })
    }
    const { start } = monthTimestampRange(from)
    const { end } = monthTimestampRange(to)
    return watchExpensesRange(householdId, start, end, onChange, (error) => {
      reportSyncError(error)
      onChange([])
    })
  })
}
