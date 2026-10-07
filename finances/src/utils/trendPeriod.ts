import type { Cents } from '@/types'
import type { Expense } from '@/types/expense'
import type { Income } from '@/types/income'
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

/** Début de la plage à lire dans Firestore pour la période demandée. */
export function periodStart(period: TrendPeriod, month: MonthKey): Date {
  if (period === '1m') return monthRange(month).start
  if (period === 'all') return new Date(2000, 0, 1)
  return monthRange(shiftMonth(month, -(MONTHS_BY_PERIOD[period] - 1))).start
}

function shortMonth(key: MonthKey, withYear: boolean): string {
  const name = formatMonthKey(key).replace(/ \d{4}$/, '').slice(0, 3)
  return withYear ? `${name} ${key.slice(2, 4)}` : name
}

const WEEKS: { from: number; to: number }[] = [
  { from: 1, to: 7 },
  { from: 8, to: 14 },
  { from: 15, to: 21 },
  { from: 22, to: 31 },
]

/**
 * Points du graphique : par semaine pour « 1 mois », par mois sinon.
 */
export function buildPeriodPoints(period: TrendPeriod, month: MonthKey, expenses: Expense[], incomes: Income[]): PeriodPoint[] {
  if (period === '1m') {
    const inMonth = (item: { date: { toDate(): Date } }) => monthKey(item.date.toDate()) === month
    return WEEKS.map(({ from, to }) => {
      const inWeek = (item: { date: { toDate(): Date } }) => inMonth(item) && item.date.toDate().getDate() >= from && item.date.toDate().getDate() <= to
      return {
        label: to >= 28 ? `${from}–fin` : `${from}–${to}`,
        incomeCents: incomes.filter(inWeek).reduce((t, i) => t + i.amountCents, 0),
        expenseCents: expenses.filter(inWeek).reduce((t, e) => t + e.amountCents, 0),
      }
    })
  }

  let first: MonthKey
  if (period === 'all') {
    const dates = [...expenses, ...incomes].map((i) => monthKey(i.date.toDate()))
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
    expenseCents: expenses.filter((e) => monthKey(e.date.toDate()) === m).reduce((t, e) => t + e.amountCents, 0),
  }))
}
