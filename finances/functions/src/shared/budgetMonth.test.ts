import { describe, expect, it } from 'vitest'
import { budgetMonthBounds, budgetMonthKey } from './budgetMonth.js'

describe('mois budgétaire du 6 au 5', () => {
  it('range les dates du 1er au 5 dans le mois précédent', () => {
    expect(budgetMonthKey(new Date(2026, 9, 5, 12))).toBe('2026-09')
    expect(budgetMonthKey(new Date(2026, 9, 6, 12))).toBe('2026-10')
    expect(budgetMonthKey(new Date(2027, 0, 2, 12))).toBe('2026-12')
  })
  it('borne [6, 6[', () => {
    expect(budgetMonthBounds('2026-12')).toEqual({ start: new Date(2026, 11, 6), end: new Date(2027, 0, 6) })
  })
})
