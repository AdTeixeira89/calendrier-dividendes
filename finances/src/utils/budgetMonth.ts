import { Timestamp } from 'firebase/firestore'
import { budgetMonthBounds, budgetMonthKey, expenseFetchBounds, expenseMonthKey, isRecurringExpense, BUDGET_MONTH_START_DAY } from '@shared/budgetMonth'
import type { Expense } from '@/types'
import type { MonthKey } from './month'

export { budgetMonthBounds, budgetMonthKey, isRecurringExpense, BUDGET_MONTH_START_DAY }

/** Mois comptable d'une dépense : celui de sa date si elle est récurrente (prêt, abonnement…), sinon le mois budgétaire du 6 au 5. */
export function expenseBudgetMonth(expense: Pick<Expense, 'date' | 'kind' | 'recurrenceId'>): MonthKey {
  return expenseMonthKey(expense.date.toDate(), expense)
}

/** Plage Firestore à lire pour les dépenses de [from, to] ; à filtrer ensuite avec `expenseBudgetMonth`. */
export function expenseFetchTimestampRange(from: MonthKey, to: MonthKey = from): { start: Timestamp; end: Timestamp } {
  const { start, end } = expenseFetchBounds(from, to)
  return { start: Timestamp.fromDate(start), end: Timestamp.fromDate(end) }
}

/** Mois budgétaire d'aujourd'hui (du 1er au 5, c'est encore le mois précédent). */
export function currentBudgetMonthKey(today: Date = new Date()): MonthKey {
  return budgetMonthKey(today)
}

export function isCurrentBudgetMonth(key: MonthKey): boolean {
  return key === currentBudgetMonthKey()
}

export function budgetMonthTimestampRange(key: MonthKey): { start: Timestamp; end: Timestamp } {
  const { start, end } = budgetMonthBounds(key)
  return { start: Timestamp.fromDate(start), end: Timestamp.fromDate(end) }
}

/** « du 6 septembre au 5 octobre » */
export function formatBudgetPeriod(key: MonthKey): string {
  const { start, end } = budgetMonthBounds(key)
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 1)
  const day = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' })
  return `du ${day.format(start)} au ${day.format(last)}`
}
