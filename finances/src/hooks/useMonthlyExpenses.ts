import { useMemo } from 'react'
import { watchMonthlyExpenses } from '@/services/expenseService'
import { reportSyncError } from '@/services/repository'
import type { Expense } from '@/types'
import type { MonthKey } from '@/utils/month'
import { commonExpenses } from '@/utils/spaces'
import { useKeyedSnapshot } from './useKeyedSnapshot'

export function useMonthlyExpenses(householdId: string, month: MonthKey): Expense[] | undefined {
  return useKeyedSnapshot<Expense[]>(`${householdId}:${month}`, (onChange) =>
    watchMonthlyExpenses(householdId, month, onChange, (error) => {
      reportSyncError(error)
      onChange([])
    }),
  )
}

/** Dépenses communes du mois : base des totaux et suivis du foyer (accueil, analyse, alertes). */
export function useCommonMonthlyExpenses(householdId: string, month: MonthKey): Expense[] | undefined {
  const all = useMonthlyExpenses(householdId, month)
  return useMemo(() => (all ? commonExpenses(all) : undefined), [all])
}
