import { useMemo } from 'react'
import { Timestamp } from 'firebase/firestore'
import { useCurrentUser } from '@/hooks/useAuth'
import { watchExpensesRange } from '@/services/expenseService'
import type { HomeView } from '@/services/homePrefsService'
import { watchIncomesRange } from '@/services/incomeService'
import type { Expense, Income } from '@/types'
import { monthRange, type MonthKey } from '@/utils/month'
import { commonExpenses, inSpace } from '@/utils/spaces'
import { buildPeriodPoints, periodStart, type PeriodPoint, type TrendPeriod } from '@/utils/trendPeriod'
import { useKeyedSnapshot } from './useKeyedSnapshot'

/**
 * Revenus et dépenses sur la période choisie (semaines pour 1 mois, mois sinon).
 * `view` « common » : dépenses communes du foyer ; « personal » : les dépenses personnelles
 * (privées comprises) et les revenus du titulaire du compte.
 */
export function usePeriodTrend(householdId: string, month: MonthKey, period: TrendPeriod, view: HomeView = 'common'): PeriodPoint[] | undefined {
  const user = useCurrentUser()
  const start = Timestamp.fromDate(periodStart(period, month))
  const end = Timestamp.fromDate(monthRange(month).end)
  const key = `${householdId}:${month}:${period}`

  const expenses = useKeyedSnapshot<Expense[]>(key, (onChange) => watchExpensesRange(householdId, start, end, onChange, () => onChange([])))
  const incomes = useKeyedSnapshot<Income[]>(key, (onChange) => watchIncomesRange(householdId, start, end, onChange, () => onChange([])))

  return useMemo(() => {
    if (expenses === undefined || incomes === undefined) return undefined
    return view === 'personal'
      ? buildPeriodPoints(period, month, inSpace(expenses, user.uid), incomes.filter((i) => i.memberId === user.uid))
      : buildPeriodPoints(period, month, commonExpenses(expenses), incomes)
  }, [expenses, incomes, view, period, month, user.uid])
}
