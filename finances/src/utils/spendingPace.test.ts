import { describe, expect, it } from 'vitest'
import { spendingPace } from './spendingPace'

const e = (amountCents: number, y: number, m: number, d: number) => ({ amountCents, date: new Date(y, m - 1, d, 12) })

describe('spendingPace (mois budgétaire du 6 au 5)', () => {
  it('cumule jour par jour depuis le 6 et s’arrête à aujourd’hui pour le mois en cours', () => {
    // Septembre = du 6 septembre au 5 octobre (30 jours) ; août = du 6 août au 5 septembre (31 jours).
    const points = spendingPace('2026-09', [e(1000, 2026, 9, 6), e(500, 2026, 9, 8)], '2026-08', [e(2000, 2026, 8, 7)], new Date(2026, 8, 9))
    expect(points).toHaveLength(31)
    expect(points.slice(0, 5).map((p) => p.currentCents)).toEqual([1000, 1000, 1500, 1500, null])
    expect(points.slice(0, 3).map((p) => p.previousCents)).toEqual([0, 2000, 2000])
    expect(points[30]).toEqual({ day: 31, currentCents: null, previousCents: 2000 })
  })

  it('compte une dépense du 3 octobre dans le mois de septembre (dernier jour = le 5)', () => {
    const points = spendingPace('2026-09', [e(700, 2026, 10, 3)], '2026-08', [], new Date(2026, 9, 20))
    expect(points[27]!.currentCents).toBe(700) // 3 octobre = 28e jour
    expect(points[29]!.currentCents).toBe(700)
    expect(points.slice(0, 30).every((p) => p.currentCents !== null)).toBe(true)
  })

  it('place au premier jour une dépense du mois datée avant le 6 (récurrente du 3 comptée dans son mois civil)', () => {
    const points = spendingPace('2026-10', [e(950, 2026, 10, 3)], '2026-09', [], new Date(2026, 9, 20))
    expect(points[0]!.currentCents).toBe(950)
  })

  it("n'invente aucune valeur pour un mois futur", () => {
    const points = spendingPace('2026-11', [], '2026-10', [], new Date(2026, 8, 20))
    expect(points.every((p) => p.currentCents === null)).toBe(true)
  })
})
