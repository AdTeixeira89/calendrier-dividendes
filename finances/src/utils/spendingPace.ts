import type { Cents } from '@/types'
import { budgetMonthBounds } from './budgetMonth'
import type { MonthKey } from './month'

export interface PacePoint {
  /** Jour du mois budgétaire (1 = le 6 du mois civil). */
  day: number
  /** Cumul du mois affiché ; null après aujourd'hui (jours pas encore vécus). */
  currentCents: Cents | null
  /** Cumul du mois précédent ; null si ce mois-là n'a pas autant de jours. */
  previousCents: Cents | null
}

const DAY_MS = 86_400_000

function daysIn(month: MonthKey): number {
  const { start, end } = budgetMonthBounds(month)
  return Math.round((end.getTime() - start.getTime()) / DAY_MS)
}

/** Rang du jour dans le mois budgétaire (0 = le 6), en jours calendaires. */
function dayIndex(date: Date, start: Date): number {
  const a = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  const b = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())
  return Math.round((a - b) / DAY_MS)
}

function cumulativeByDay(expenses: { amountCents: Cents; date: Date }[], month: MonthKey): Cents[] {
  const days = daysIn(month)
  const { start } = budgetMonthBounds(month)
  const perDay = new Array<Cents>(days).fill(0)
  for (const e of expenses) {
    const i = dayIndex(e.date, start)
    if (i >= 0 && i < days) perDay[i]! += e.amountCents
  }
  let running = 0
  return perDay.map((cents) => (running += cents))
}

/**
 * Dépenses cumulées jour après jour sur le mois budgétaire (du 6 au 5), comparées au mois
 * précédent : on voit d'un coup d'œil si l'on dépense plus vite ou moins vite que d'habitude.
 */
export function spendingPace(
  month: MonthKey,
  expenses: { amountCents: Cents; date: Date }[],
  previousMonth: MonthKey,
  previousExpenses: { amountCents: Cents; date: Date }[],
  today: Date = new Date(),
): PacePoint[] {
  const days = daysIn(month)
  const prevDays = daysIn(previousMonth)
  const current = cumulativeByDay(expenses, month)
  const previous = cumulativeByDay(previousExpenses, previousMonth)
  const { start } = budgetMonthBounds(month)
  const todayIndex = dayIndex(today, start)
  const lastDay = todayIndex < 0 ? 0 : todayIndex >= days ? days : todayIndex + 1

  return Array.from({ length: Math.max(days, prevDays) }, (_, i) => ({
    day: i + 1,
    currentCents: i < lastDay && i < days ? current[i]! : null,
    previousCents: i < prevDays ? previous[i]! : null,
  }))
}
