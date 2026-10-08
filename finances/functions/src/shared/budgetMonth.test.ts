import { describe, expect, it } from 'vitest'
import { budgetMonthBounds, budgetMonthKey, expenseFetchBounds, expenseMonthKey, isRecurringExpense } from './budgetMonth.js'

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

describe('dépenses récurrentes : toujours le mois de leur date', () => {
  const recurring = { kind: 'recurring' }
  it('le prélèvement du 5 octobre compte pour octobre, jamais pour septembre', () => {
    for (const day of [1, 5, 15, 30]) expect(expenseMonthKey(new Date(2026, 9, day, 12), recurring)).toBe('2026-10')
    expect(expenseMonthKey(new Date(2026, 9, 5, 12), { kind: 'one_off' })).toBe('2026-09') // une dépense courante garde la règle du 6 au 5
  })
  it('reconnaît prêts, abonnements et reprises (recurrenceId) comme récurrents', () => {
    expect(isRecurringExpense({ kind: 'one_off', recurrenceId: 'pret' })).toBe(true)
    expect(isRecurringExpense({ kind: 'exceptional' })).toBe(false)
  })
  it('la plage de lecture couvre les deux sortes de dépenses', () => {
    expect(expenseFetchBounds('2026-09', '2026-10')).toEqual({ start: new Date(2026, 8, 1), end: new Date(2026, 10, 6) })
  })
})
