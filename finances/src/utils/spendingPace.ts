import type { Cents } from '@/types'
import { monthRange, type MonthKey } from './month'

export interface PacePoint {
  day: number
  /** Cumul du mois affiché ; null après aujourd'hui (jours pas encore vécus). */
  currentCents: Cents | null
  /** Cumul du mois précédent ; null si ce mois-là n'a pas autant de jours. */
  previousCents: Cents | null
}

function daysIn(month: MonthKey): number {
  const { start, end } = monthRange(month)
  return Math.round((end.getTime() - start.getTime()) / 86_400_000)
}

function cumulativeByDay(expenses: { amountCents: Cents; date: Date }[], days: number): Cents[] {
  const perDay = new Array<Cents>(days).fill(0)
  for (const e of expenses) {
    const day = e.date.getDate()
    if (day >= 1 && day <= days) perDay[day - 1]! += e.amountCents
  }
  let running = 0
  return perDay.map((cents) => (running += cents))
}

/**
 * Dépenses cumulées jour après jour, comparées au mois précédent : on voit
 * d'un coup d'œil si l'on dépense plus vite ou moins vite que d'habitude.
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
  const current = cumulativeByDay(expenses, days)
  const previous = cumulativeByDay(previousExpenses, prevDays)
  const { start } = monthRange(month)
  const isCurrent = today.getFullYear() === start.getFullYear() && today.getMonth() === start.getMonth()
  const lastDay = isCurrent ? today.getDate() : today < start ? 0 : days

  return Array.from({ length: Math.max(days, prevDays) }, (_, i) => ({
    day: i + 1,
    currentCents: i < lastDay && i < days ? current[i]! : null,
    previousCents: i < prevDays ? previous[i]! : null,
  }))
}
