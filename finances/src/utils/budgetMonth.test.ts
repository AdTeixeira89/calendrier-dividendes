import { describe, expect, it } from 'vitest'
import { budgetMonthBounds, budgetMonthKey, currentBudgetMonthKey, formatBudgetPeriod } from './budgetMonth'

describe('mois budgétaire (du 6 au 5)', () => {
  it('compte les dépenses du 1er au 5 dans le mois précédent', () => {
    expect(budgetMonthKey(new Date(2026, 9, 5, 12))).toBe('2026-09') // 5 octobre → septembre
    expect(budgetMonthKey(new Date(2026, 9, 1, 0, 0))).toBe('2026-09')
    expect(budgetMonthKey(new Date(2026, 9, 6, 0, 0))).toBe('2026-10') // le 6 démarre octobre
    expect(budgetMonthKey(new Date(2026, 9, 31, 12))).toBe('2026-10')
  })

  it('passe correctement le cap de l’année', () => {
    expect(budgetMonthKey(new Date(2027, 0, 3, 12))).toBe('2026-12')
    expect(budgetMonthKey(new Date(2027, 0, 6, 12))).toBe('2027-01')
  })

  it('donne les bornes du 6 au 6', () => {
    const { start, end } = budgetMonthBounds('2026-09')
    expect(start).toEqual(new Date(2026, 8, 6))
    expect(end).toEqual(new Date(2026, 9, 6))
    expect(budgetMonthBounds('2026-12').end).toEqual(new Date(2027, 0, 6))
  })

  it('le mois en cours dépend du jour', () => {
    expect(currentBudgetMonthKey(new Date(2026, 9, 3))).toBe('2026-09')
    expect(currentBudgetMonthKey(new Date(2026, 9, 20))).toBe('2026-10')
  })

  it('décrit la période', () => {
    expect(formatBudgetPeriod('2026-09')).toBe('du 6 septembre au 5 octobre')
  })
})
