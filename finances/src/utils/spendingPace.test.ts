import { describe, expect, it } from 'vitest'
import { spendingPace } from './spendingPace'

const e = (amountCents: number, y: number, m: number, d: number) => ({ amountCents, date: new Date(y, m - 1, d, 12) })

describe('spendingPace', () => {
  it('cumule les dépenses jour par jour et s’arrête à aujourd’hui pour le mois en cours', () => {
    const points = spendingPace('2026-09', [e(1000, 2026, 9, 1), e(500, 2026, 9, 3)], '2026-08', [e(2000, 2026, 8, 2)], new Date(2026, 8, 4))
    expect(points).toHaveLength(31) // août a 31 jours, septembre 30
    expect(points.slice(0, 5).map((p) => p.currentCents)).toEqual([1000, 1000, 1500, 1500, null])
    expect(points.slice(0, 3).map((p) => p.previousCents)).toEqual([0, 2000, 2000])
    expect(points[30]).toEqual({ day: 31, currentCents: null, previousCents: 2000 })
  })

  it('trace le mois complet pour un mois passé', () => {
    const points = spendingPace('2026-08', [e(700, 2026, 8, 31)], '2026-07', [], new Date(2026, 8, 20))
    expect(points[30]!.currentCents).toBe(700)
    expect(points.every((p) => p.currentCents !== null)).toBe(true)
  })

  it("n'invente aucune valeur pour un mois futur", () => {
    const points = spendingPace('2026-11', [], '2026-10', [], new Date(2026, 8, 20))
    expect(points.every((p) => p.currentCents === null)).toBe(true)
  })
})
