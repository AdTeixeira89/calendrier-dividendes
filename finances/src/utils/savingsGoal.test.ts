import { describe, expect, it } from 'vitest'
import { estimatedGoalDate, goalProgress, monthsToReachGoal } from './savingsGoal'

describe('goalProgress', () => {
  it('calcule le pourcentage et borne à 100', () => {
    expect(goalProgress(6500, 10000)).toBe(65)
    expect(goalProgress(12000, 10000)).toBe(100)
    expect(goalProgress(0, 10000)).toBe(0)
  })
  it('gère un objectif à 0', () => {
    expect(goalProgress(0, 0)).toBe(0)
  })
})

describe('monthsToReachGoal', () => {
  it('calcule le nombre de mois nécessaires (arrondi au mois supérieur)', () => {
    expect(monthsToReachGoal(6500, 10000, 500)).toBe(7)
    expect(monthsToReachGoal(6500, 10000, 350)).toBe(10)
  })
  it('retourne 0 si déjà atteint', () => {
    expect(monthsToReachGoal(10000, 10000, 500)).toBe(0)
    expect(monthsToReachGoal(15000, 10000, 500)).toBe(0)
  })
  it('retourne null sans versement prévu', () => {
    expect(monthsToReachGoal(0, 10000, 0)).toBeNull()
  })
})

describe('estimatedGoalDate', () => {
  it('ajoute le bon nombre de mois à la date de référence', () => {
    const from = new Date(2026, 8, 24)
    const date = estimatedGoalDate(6500, 10000, 500, from)
    expect(date).toEqual(new Date(2027, 3, 24))
  })
  it('null si non estimable', () => {
    expect(estimatedGoalDate(0, 10000, 0)).toBeNull()
  })
})
