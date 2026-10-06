import { Timestamp } from 'firebase/firestore'
import { watchExpensesRange } from '@/services/expenseService'
import { watchIncomesRange } from '@/services/incomeService'
import type { Cents, Expense, Income } from '@/types'
import { monthRange, type MonthKey } from '@/utils/month'
import { buildPeriodPoints, periodStart, type PeriodPoint, type TrendPeriod } from '@/utils/trendPeriod'
import { useKeyedSnapshot } from './useKeyedSnapshot'

/** Revenus et dépenses sur la période choisie (semaines pour 1 mois, mois sinon). */
export function usePeriodTrend(householdId: string, month: MonthKey, period: TrendPeriod, debtMonthlyCents: Cents): PeriodPoint[] | undefined {
  const start = Timestamp.fromDate(periodStart(period, month))
  const end = Timestamp.fromDate(monthRange(month).end)
  const key = `${householdId}:${month}:${period}`

  const expenses = useKeyedSnapshot<Expense[]>(key, (onChange) => watchExpensesRange(householdId, start, end, onChange, () => onChange([])))
  const incomes = useKeyedSnapshot<Income[]>(key, (onChange) => watchIncomesRange(householdId, start, end, onChange, () => onChange([])))

  if (expenses === undefined || incomes === undefined) return undefined
  return buildPeriodPoints(period, month, expenses, incomes, debtMonthlyCents)
}
