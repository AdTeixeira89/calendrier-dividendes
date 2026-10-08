import type { Cents } from '@/types'
import type { Expense } from '@/types/expense'
import type { Income } from '@/types/income'
import { budgetMonthBounds, expenseBudgetMonth } from './budgetMonth'
import { formatMonthKey, monthKey, monthRange, shiftMonth, type MonthKey } from './month'

export type TrendPeriod = '1m' | '3m' | '6m' | '12m' | 'all'

export const TREND_PERIODS: { value: TrendPeriod; label: string; full: string }[] = [
  { value: '1m', label: '1 mois', full: 'Mois en cours, semaine par semaine' },
  { value: '3m', label: '3 mois', full: '3 derniers mois' },
  { value: '6m', label: '6 mois', full: '6 derniers mois' },
  { value: '12m', label: '1 an', full: '12 derniers mois' },
  { value: 'all', label: 'Début', full: 'Depuis le début' },
]

export interface PeriodPoint {
  label: string
  incomeCents: Cents
  expenseCents: Cents
}

const MONTHS_BY_PERIOD: Record<Exclude<TrendPeriod, '1m' | 'all'>, number> = { '3m': 3, '6m': 6, '12m': 12 }

/** Premier mois de la période (null pour « depuis le début »). */
export function periodFirstMonth(period: TrendPeriod, month: MonthKey): MonthKey | null {
  if (period === 'all') return null
  if (period === '1m') return month
  return shiftMonth(month, -(MONTHS_BY_PERIOD[period] - 1))
}

/** Début de la plage de revenus à lire dans Firestore pour la période demandée (mois civils). */
export function periodStart(period: TrendPeriod, month: MonthKey): Date {
  if (period === '1m') return monthRange(month).start
  if (period === 'all') return new Date(2000, 0, 1)
  return monthRange(shiftMonth(month, -(MONTHS_BY_PERIOD[period] - 1))).start
}

function shortMonth(key: MonthKey, withYear: boolean): string {
  const name = formatMonthKey(key).replace(/ \d{4}$/, '').slice(0, 3)
  return withYear ? `${name} ${key.slice(2, 4)}` : name
}

const WEEK_COUNT = 4

/**
 * Points du graphique : par semaine pour « 1 mois » (le mois budgétaire du 6 au 5), par mois sinon.
 * Les dépenses courantes sont rangées par mois budgétaire (celles du 1er au 5 comptent pour le mois précédent) ;
 * les récurrentes et mensualités de prêt dans le mois de leur date ; les revenus restent par mois civil.
 */
export function buildPeriodPoints(period: TrendPeriod, month: MonthKey, expenses: Expense[], incomes: Income[]): PeriodPoint[] {
  if (period === '1m') {
    const { start, end } = budgetMonthBounds(month)
    const dayMs = 86_400_000
    const span = Math.round((end.getTime() - start.getTime()) / dayMs)
    const weekOf = (date: Date) => {
      const offset = Math.floor((date.getTime() - start.getTime()) / dayMs)
      return offset < 0 || offset >= span ? -1 : Math.min(WEEK_COUNT - 1, Math.floor(offset / 7))
    }
    // Une dépense du mois (les récurrentes du 1er au 5 en font partie) tombe dans la première ou la dernière semaine si sa date est hors du 6 → 5.
    const expenseWeekOf = (e: Expense) => {
      if (expenseBudgetMonth(e) !== month) return -1
      const offset = Math.floor((e.date.toDate().getTime() - start.getTime()) / dayMs)
      return Math.min(WEEK_COUNT - 1, Math.floor(Math.min(span - 1, Math.max(0, offset)) / 7))
    }
    const label = (week: number) => {
      const first = new Date(start.getFullYear(), start.getMonth(), start.getDate() + week * 7)
      if (week < WEEK_COUNT - 1) return `${first.getDate()}–${new Date(first.getFullYear(), first.getMonth(), first.getDate() + 6).getDate()}`
      return `${first.getDate()}–${new Date(end.getFullYear(), end.getMonth(), end.getDate() - 1).getDate()}`
    }
    return Array.from({ length: WEEK_COUNT }, (_, week) => ({
      label: label(week),
      incomeCents: incomes.filter((i) => weekOf(i.date.toDate()) === week).reduce((t, i) => t + i.amountCents, 0),
      expenseCents: expenses.filter((e) => expenseWeekOf(e) === week).reduce((t, e) => t + e.amountCents, 0),
    }))
  }

  let first: MonthKey
  if (period === 'all') {
    const dates = [...expenses.map((e) => expenseBudgetMonth(e)), ...incomes.map((i) => monthKey(i.date.toDate()))]
    const earliest = dates.length > 0 ? dates.reduce((a, b) => (a < b ? a : b)) : month
    const previous = shiftMonth(month, -1)
    first = earliest < previous ? earliest : previous
  } else {
    first = shiftMonth(month, -(MONTHS_BY_PERIOD[period] - 1))
  }

  const months: MonthKey[] = []
  for (let m = first; m <= month; m = shiftMonth(m, 1)) months.push(m)
  const withYear = months.length > 6
  return months.map((m) => ({
    label: shortMonth(m, withYear),
    incomeCents: incomes.filter((i) => monthKey(i.date.toDate()) === m).reduce((t, i) => t + i.amountCents, 0),
    expenseCents: expenses.filter((e) => expenseBudgetMonth(e) === m).reduce((t, e) => t + e.amountCents, 0),
  }))
}
