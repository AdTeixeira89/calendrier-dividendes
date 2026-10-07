import { Timestamp } from 'firebase/firestore'
import { describe, expect, it } from 'vitest'
import type { Expense } from '@/types/expense'
import type { Income } from '@/types/income'
import { buildPeriodPoints, periodStart } from './trendPeriod'

const at = (y: number, m: number, d: number) => Timestamp.fromDate(new Date(y, m - 1, d, 12))
const inc = (date: Timestamp, amountCents: number) => ({ date, amountCents }) as Income
const exp = (date: Timestamp, amountCents: number) => ({ date, amountCents }) as Expense

describe('trendPeriod', () => {
  it('découpe le mois budgétaire (du 6 au 5) par semaine', () => {
    const points = buildPeriodPoints(
      '1m',
      '2026-10',
      [exp(at(2026, 10, 7), 1000), exp(at(2026, 10, 25), 500), exp(at(2026, 11, 3), 200), exp(at(2026, 10, 3), 999), exp(at(2026, 11, 6), 888)],
      [inc(at(2026, 10, 8), 3000)],
    )
    expect(points.map((p) => p.label)).toEqual(['6–12', '13–19', '20–26', '27–5'])
    expect(points.map((p) => p.expenseCents)).toEqual([1000, 0, 500, 200]) // le 3 octobre compte pour septembre, le 6 novembre pour novembre
    expect(points.map((p) => p.incomeCents)).toEqual([3000, 0, 0, 0])
  })

  it('range les dépenses du 1er au 5 dans le mois précédent (le 5 octobre compte pour septembre)', () => {
    const points = buildPeriodPoints('3m', '2026-10', [exp(at(2026, 10, 5), 700), exp(at(2026, 10, 6), 300), exp(at(2026, 9, 6), 100)], [inc(at(2026, 10, 5), 2000)])
    expect(points.map((p) => p.expenseCents)).toEqual([0, 800, 300]) // août, septembre (5 oct + 6 sept), octobre (6 oct)
    expect(points.map((p) => p.incomeCents)).toEqual([0, 0, 2000]) // les revenus restent par mois civil
  })

  it('ne rajoute rien aux dépenses saisies (les mensualités de prêts sont de vraies dépenses, à leur date)', () => {
    const months = buildPeriodPoints('3m', '2026-10', [], [])
    expect(months).toHaveLength(3)
    expect(months.every((p) => p.expenseCents === 0)).toBe(true)
  })

  it('couvre 3, 6 et 12 mois', () => {
    expect(buildPeriodPoints('6m', '2026-10', [], [])).toHaveLength(6)
    const year = buildPeriodPoints('12m', '2026-10', [], [])
    expect(year).toHaveLength(12)
    expect(year[0]!.label).toMatch(/ 25$/)
  })

  it('« depuis le début » part du mois le plus ancien, avec au moins 2 mois', () => {
    expect(buildPeriodPoints('all', '2026-10', [exp(at(2026, 5, 10), 100)], [])).toHaveLength(6)
    expect(buildPeriodPoints('all', '2026-10', [], [])).toHaveLength(2)
  })

  it('calcule le début de lecture', () => {
    expect(periodStart('3m', '2026-10').getMonth()).toBe(7)
    expect(periodStart('all', '2026-10').getFullYear()).toBe(2000)
  })
})
