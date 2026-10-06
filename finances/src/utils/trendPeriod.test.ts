import { Timestamp } from 'firebase/firestore'
import { describe, expect, it } from 'vitest'
import type { Expense } from '@/types/expense'
import type { Income } from '@/types/income'
import { buildPeriodPoints, periodStart } from './trendPeriod'

const at = (y: number, m: number, d: number) => Timestamp.fromDate(new Date(y, m - 1, d, 12))
const inc = (date: Timestamp, amountCents: number) => ({ date, amountCents }) as Income
const exp = (date: Timestamp, amountCents: number) => ({ date, amountCents }) as Expense

describe('trendPeriod', () => {
  it('découpe le mois en cours par semaine', () => {
    const points = buildPeriodPoints('1m', '2026-10', [exp(at(2026, 10, 3), 1000), exp(at(2026, 10, 25), 500), exp(at(2026, 9, 25), 999)], [inc(at(2026, 10, 2), 3000)], 0)
    expect(points.map((p) => p.expenseCents)).toEqual([1000, 0, 0, 500])
    expect(points.map((p) => p.incomeCents)).toEqual([3000, 0, 0, 0])
  })

  it('répartit les prêts sur les semaines et les ajoute à chaque mois', () => {
    expect(buildPeriodPoints('1m', '2026-10', [], [], 40_000).every((p) => p.expenseCents === 10_000)).toBe(true)
    const months = buildPeriodPoints('3m', '2026-10', [], [], 40_000)
    expect(months).toHaveLength(3)
    expect(months.every((p) => p.expenseCents === 40_000)).toBe(true)
  })

  it('couvre 3, 6 et 12 mois', () => {
    expect(buildPeriodPoints('6m', '2026-10', [], [], 0)).toHaveLength(6)
    const year = buildPeriodPoints('12m', '2026-10', [], [], 0)
    expect(year).toHaveLength(12)
    expect(year[0]!.label).toMatch(/ 25$/)
  })

  it('« depuis le début » part du mois le plus ancien, avec au moins 2 mois', () => {
    expect(buildPeriodPoints('all', '2026-10', [exp(at(2026, 5, 3), 100)], [], 0)).toHaveLength(6)
    expect(buildPeriodPoints('all', '2026-10', [], [], 0)).toHaveLength(2)
  })

  it('calcule le début de lecture', () => {
    expect(periodStart('3m', '2026-10').getMonth()).toBe(7)
    expect(periodStart('all', '2026-10').getFullYear()).toBe(2000)
  })
})
