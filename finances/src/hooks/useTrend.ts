import { Timestamp } from 'firebase/firestore'
import { watchExpensesRange } from '@/services/expenseService'
import { watchIncomesRange } from '@/services/incomeService'
import type { Expense, Income } from '@/types'
import { lastMonths, monthKey, monthRange, type MonthKey as MonthKeyType } from '@/utils/month'
import { useKeyedSnapshot } from './useKeyedSnapshot'

export interface TrendPoint {
  month: MonthKeyType
  incomeCents: number
  expenseCents: number
}

/** Totaux revenus/dépenses des `count` derniers mois, `month` inclus. */
export function useTrend(householdId: string, month: MonthKeyType, count = 6): TrendPoint[] | undefined {
  const months = lastMonths(month, count)
  const start = Timestamp.fromDate(monthRange(months[0]!).start)
  const end = Timestamp.fromDate(monthRange(months[months.length - 1]!).end)
  const key = `${householdId}:${months[0]}:${months[months.length - 1]}`

  const expenses = useKeyedSnapshot<Expense[]>(key, (onChange) => watchExpensesRange(householdId, start, end, onChange, () => onChange([])))
  const incomes = useKeyedSnapshot<Income[]>(key, (onChange) => watchIncomesRange(householdId, start, end, onChange, () => onChange([])))

  if (expenses === undefined || incomes === undefined) return undefined

  return months.map((m) => ({
    month: m,
    incomeCents: incomes.filter((i) => monthKey(i.date.toDate()) === m).reduce((sum, i) => sum + i.amountCents, 0),
    expenseCents: expenses.filter((e) => monthKey(e.date.toDate()) === m).reduce((sum, e) => sum + e.amountCents, 0),
  }))
}
