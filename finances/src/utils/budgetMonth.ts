import { Timestamp } from 'firebase/firestore'
import { budgetMonthBounds, budgetMonthKey, BUDGET_MONTH_START_DAY } from '@shared/budgetMonth'
import type { MonthKey } from './month'

export { budgetMonthBounds, budgetMonthKey, BUDGET_MONTH_START_DAY }

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
