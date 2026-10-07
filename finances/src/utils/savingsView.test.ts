import { describe, expect, it } from 'vitest'
import { savingsTotal } from './savingsView'

const goals = [
  { scope: 'shared' as const, memberId: null, currentCents: 100_000 },
  { scope: undefined, memberId: undefined, currentCents: 50_000 }, // ancien objectif : commun
  { scope: 'personal' as const, memberId: 'adao', currentCents: 30_000 },
  { scope: 'personal' as const, memberId: 'angelique', currentCents: 7_000 },
]

describe('épargne commune / personnelle', () => {
  it('additionne le commun sans les épargnes personnelles', () => {
    expect(savingsTotal(goals, 'common', 'adao')).toBe(150_000)
  })
  it('additionne seulement l’épargne personnelle du titulaire', () => {
    expect(savingsTotal(goals, 'personal', 'adao')).toBe(30_000)
    expect(savingsTotal(goals, 'personal', 'angelique')).toBe(7_000)
    expect(savingsTotal(goals, 'personal', 'autre')).toBe(0)
  })
})
